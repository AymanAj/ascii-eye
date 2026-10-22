(() => {
  const AsciiParts = (window.AsciiParts = window.AsciiParts || {});

  const PAD = 2;          // device px of empty border around every atlas slot
  const GAMMA = 0.75;     // below 1 lifts dark tones, so a dim wall still shows sparse glyphs
  const WHITE_MIN = 200;  // every channel at least this bright reads as white light
  const FADE = 0.3;       // share of the reveal range over which one cell fades in
  const BLANK = 255;      // cell glyph index that draws nothing
  const SPACE = 32;

  // Integer hash of a cell -> [0, 1). Fixed per cell, so the dissolve grain never crawls.
  function hash01(x, y) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Why WebGL: Chrome spends ~2us per 2D canvas call (drawImage, fillRect) between JS and raster,
  // so one call per cell costs ~40-80ms for a 1080p grid, and merging runs still leaves ~20ms
  // while the dissolve breaks them up. Here one full-screen pass looks every pixel up in a
  // cols x rows texture of glyph+colour and copies it from the same pre-rendered atlas.
  const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D uCells;  // (glyph, colour bucket) per cell, glyph 255 = blank
uniform sampler2D uAtlas;   // premultiplied glyphs: one row per bucket, one slot per glyph
uniform vec2 uPitch;        // cell size in device px
uniform ivec2 uGrid;
uniform ivec2 uSlot;
uniform int uPad;
uniform int uHeight;
uniform vec3 uBg;
out vec4 outColor;

// Cell edges sit at round(i * pitch), the same device pixels a per-cell drawImage would use.
int cellOf(float p, float pitch, out int edge) {
  int i = int(floor((p + 0.5) / pitch));
  if (floor(float(i) * pitch + 0.5) > p) i--;
  else if (floor(float(i + 1) * pitch + 0.5) <= p) i++;
  edge = int(floor(float(i) * pitch + 0.5));
  return i;
}

void main() {
  float px = floor(gl_FragCoord.x);
  float py = float(uHeight - 1) - floor(gl_FragCoord.y);
  int x0, y0;
  int c = cellOf(px, uPitch.x, x0);
  int r = cellOf(py, uPitch.y, y0);
  vec3 col = uBg;
  if (c < uGrid.x && r < uGrid.y) {
    uvec2 cell = texelFetch(uCells, ivec2(c, r), 0).rg;
    if (cell.r != 255u) {
      ivec2 t = ivec2(int(cell.r) * uSlot.x + uPad + int(px) - x0,
                      int(cell.g) * uSlot.y + uPad + int(py) - y0);
      vec4 g = texelFetch(uAtlas, t, 0);
      col = g.rgb + uBg * (1.0 - g.a);
    }
  }
  outColor = vec4(col, 1.0);
}`;

  // Per canvas: which renderer draws into it and, for WebGL, the program, textures and context
  // listeners. The page makes a new renderer on the same canvas whenever its font size changes;
  // the newest one takes the canvas over and reuses this state, so nothing piles up per re-create
  // and a context restore recompiles once.
  const canvasState = new WeakMap();

  function compileGL(s) {
    const gl = s.gl;
    if (gl.isContextLost()) {
      s.lost = true; // compiled again on webglcontextrestored
      return;
    }
    const shader = (type, text) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, text);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error('ascii-canvas shader: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('ascii-canvas program: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    const loc = (name) => gl.getUniformLocation(prog, name);
    s.u = {
      pitch: loc('uPitch'), grid: loc('uGrid'), slot: loc('uSlot'), height: loc('uHeight'), bg: loc('uBg'),
    };
    gl.uniform1i(loc('uCells'), 0);
    gl.uniform1i(loc('uAtlas'), 1);
    gl.uniform1i(loc('uPad'), PAD);
    const texture = (unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    texture(1); // atlas
    texture(0); // cells; unit 0 stays active for the per-frame upload
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindVertexArray(gl.createVertexArray());
  }

  function stateOf(canvas) {
    let s = canvasState.get(canvas);
    if (s) return s;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    s = { gl, lost: false, u: null, owner: null, onRestore: null };
    if (gl) {
      compileGL(s);
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        s.lost = true;
      });
      canvas.addEventListener('webglcontextrestored', () => {
        s.lost = false;
        compileGL(s);
        if (s.onRestore) s.onRestore();
      });
    }
    canvasState.set(canvas, s);
    return s;
  }

  function createAsciiRenderer(canvas, opts = {}) {
    const fontFamily = opts.fontFamily || 'ui-monospace, monospace';
    const fontSize = opts.fontSize || 12;
    const ramp = opts.ramp || ' .,:;=+*#%@';
    const pal = opts.palette || {};
    const bg = pal.bg || '#0b0714';
    const purple = pal.purple || ['#3d2b63', '#6e51a8', '#a98be6', '#e2d6ff'];
    const lime = pal.lime || ['#3f6212', '#7cc22e', '#c7f37a'];
    const colors = purple.concat(lime, [pal.white || '#ffffff']); // one atlas row per bucket
    const LIME0 = purple.length;
    const WHITE = LIME0 + lime.length;
    const nGlyphs = Math.min(ramp.length, BLANK);
    const blank = Array.from(ramp, (ch) => ch.trim() === '');
    const rampCodes = Uint16Array.from(ramp, (ch) => ch.charCodeAt(0));
    // dump('color') letters: purple levels 1.., lime levels a.., white W
    const bucketChars = purple.map((_, k) => String(k + 1)).join('') +
      lime.map((_, k) => String.fromCharCode(97 + k)).join('') + 'W';

    const src = document.createElement('canvas');
    const sctx = src.getContext('2d', { willReadFrequently: true });
    const atlas = document.createElement('canvas');
    const actx = atlas.getContext('2d');

    const bgRgb = (() => {
      actx.fillStyle = '#000';
      actx.fillStyle = bg;
      const v = actx.fillStyle;
      if (v[0] === '#') return [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16) / 255);
      const m = v.match(/[\d.]+/g) || [0, 0, 0];
      return [m[0] / 255, m[1] / 255, m[2] / 255];
    })();

    // Luminance byte -> glyph and colour level, so the per-cell work is table lookups.
    const glyphOf = new Int16Array(256);
    const purpleRow = new Uint8Array(256);
    const limeRow = new Uint8Array(256);
    for (let l = 0; l < 256; l++) {
      const v = Math.pow(l / 255, GAMMA);
      const gi = Math.min(nGlyphs - 1, Math.floor(v * nGlyphs));
      glyphOf[l] = blank[gi] ? -1 : gi;
      purpleRow[l] = Math.min(purple.length - 1, Math.floor(v * purple.length));
      limeRow[l] = LIME0 + Math.min(lime.length - 1, Math.floor(v * lime.length));
    }

    let W = 0, H = 0, dpr = 1, slotW = 0, slotH = 0, baseline = 0;
    let threshold = new Float32Array(0); // 0.7 * per-cell threshold
    let cells = new Uint8Array(0);       // [glyph, bucket] per cell, the frame being shown
    // 2D fallback only
    let font2d = '', advance2d = 0, textScale = 1;
    let rowY = new Float32Array(0), rowMask = new Uint32Array(0), rowChars = new Uint16Array(0);
    let xs = new Int32Array(0), ys = new Int32Array(0);

    const r = { cols: 0, rows: 0, cellW: fontSize * 0.6, cellH: fontSize, backend: '', resize, begin, render, dump };

    // ---------- output backends ----------
    const s = stateOf(canvas);
    const gl = s.gl;
    const ctx2d = gl ? null : canvas.getContext('2d');
    // The 2D fallback draws whole rows of text. Fonts like JetBrains Mono join runs such as '===', '##'
    // or '::' into ligatures; where textRendering can switch that off one pass per row is enough,
    // elsewhere each row is drawn as even and odd columns so no two glyphs ever touch in one string.
    const textRows = !!ctx2d;
    const ligSafe = textRows && 'textRendering' in ctx2d;
    r.backend = gl ? 'webgl2' : ligSafe ? '2d' : '2d-split';
    s.owner = r;
    s.onRestore = () => {
      if (W && H) uploadGL();
    };
    const owns = () => s.owner === r;

    function uploadGL() {
      const u = s.u;
      gl.viewport(0, 0, W, H);
      gl.uniform2f(u.pitch, r.cellW * dpr, r.cellH * dpr);
      gl.uniform2i(u.grid, r.cols, r.rows);
      gl.uniform2i(u.slot, slotW, slotH);
      gl.uniform1i(u.height, H);
      gl.uniform3f(u.bg, bgRgb[0], bgRgb[1], bgRgb[2]);
      gl.activeTexture(gl.TEXTURE1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.activeTexture(gl.TEXTURE0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, Math.max(1, r.cols), Math.max(1, r.rows), 0,
        gl.RG_INTEGER, gl.UNSIGNED_BYTE, null);
    }

    // ---------- grid ----------
    function buildAtlas() {
      const pitch = r.cellH * dpr;
      slotW = Math.ceil(r.cellW * dpr) + PAD * 2;
      slotH = Math.ceil(pitch) + PAD * 2;
      if (!textRows) {
        atlas.width = slotW * nGlyphs;
        atlas.height = slotH * colors.length;
      }
      actx.font = `${fontSize * dpr}px ${fontFamily}`;
      actx.textBaseline = 'alphabetic';
      const m = actx.measureText('0');
      // With line-height 1 the DOM centres the font's ascent+descent box on the line; match it,
      // then nudge so every ramp glyph's ink stays inside its own cell (cells are clipped).
      let base = m.fontBoundingBoxAscent !== undefined
        ? (pitch + m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2
        : pitch * 0.8;
      let up = 0, down = 0;
      for (let g = 0; g < nGlyphs; g++) {
        if (blank[g]) continue;
        const gm = actx.measureText(ramp[g]);
        up = Math.max(up, Math.ceil(gm.actualBoundingBoxAscent || 0));
        down = Math.max(down, Math.ceil(gm.actualBoundingBoxDescent || 0));
      }
      const minRow = Math.floor(pitch);
      base = Math.round(base);
      if (up + down <= minRow) base = Math.min(Math.max(base, up), minRow - down);
      baseline = base;
      if (textRows) return; // whole-row text needs only the baseline
      for (let k = 0; k < colors.length; k++) {
        actx.fillStyle = colors[k];
        for (let g = 0; g < nGlyphs; g++) {
          if (!blank[g]) actx.fillText(ramp[g], g * slotW + PAD, k * slotH + PAD + base);
        }
      }
    }

    function resize(width, height, devicePixelRatio) {
      if (!owns()) return r; // a newer renderer has taken this canvas over
      dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
      const cssW = Math.max(0, width || 0);
      const cssH = Math.max(0, height || 0);

      actx.font = `${fontSize}px ${fontFamily}`;
      const adv = actx.measureText('0').width || fontSize * 0.6;
      // Whole cells only, each stretched by a fraction of a pixel so the grid tiles the viewport
      // exactly. A cell hanging off the edge is only partly covered by any fill, so it would sample
      // dimmer and could fall out of the white family along the right and bottom edges.
      const cols = (r.cols = cssW > 0 ? Math.max(1, Math.floor(cssW / adv)) : 0);
      const rows = (r.rows = cssH > 0 ? Math.max(1, Math.floor(cssH / fontSize)) : 0);
      r.cellW = cols ? cssW / cols : adv;
      r.cellH = rows ? cssH / rows : fontSize;
      const n = cols * rows;

      W = Math.round(cssW * dpr);
      H = Math.round(cssH * dpr);
      canvas.width = W;
      canvas.height = H;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';

      src.width = Math.max(1, cols);
      src.height = Math.max(1, rows);
      buildAtlas();

      threshold = new Float32Array(n);
      for (let w = 0, i = 0; w < rows; w++) {
        for (let c = 0; c < cols; c++, i++) threshold[i] = 0.7 * hash01(c, w);
      }
      cells = new Uint8Array(n * 2).fill(BLANK);

      if (gl) {
        if (!s.lost && W && H) uploadGL();
      } else if (textRows) {
        rowY = new Float32Array(rows);
        rowMask = new Uint32Array(rows);
        rowChars = new Uint16Array(cols);
        for (let w = 0; w < rows; w++) rowY[w] = Math.round(w * r.cellH * dpr) + baseline;
        font2d = `${fontSize * dpr}px ${fontFamily}`;
        ctx2d.font = font2d;
        ctx2d.textRendering = 'optimizeSpeed';
        // Averaged over a full row, which is how fillText will lay the glyphs out.
        advance2d = cols ? ctx2d.measureText('0'.repeat(cols)).width / cols : 0;
        textScale = advance2d > 0 ? (r.cellW * dpr) / advance2d : 1;
      } else {
        xs = new Int32Array(cols);
        ys = new Int32Array(rows);
        for (let c = 0; c < cols; c++) xs[c] = Math.round(c * r.cellW * dpr) - PAD;
        for (let w = 0; w < rows; w++) ys[w] = Math.round(w * r.cellH * dpr) - PAD;
      }
      return r;
    }

    function begin() {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.globalAlpha = 1;
      sctx.globalCompositeOperation = 'source-over';
      sctx.fillStyle = '#000';
      sctx.fillRect(0, 0, src.width, src.height);
      sctx.setTransform(1 / r.cellW, 0, 0, 1 / r.cellH, 0, 0);
      return sctx;
    }

    // ---------- frame ----------
    function classify(reveal) {
      const cols = r.cols, rows = r.rows;
      if (!(reveal > 0)) {
        cells.fill(BLANK);
        return;
      }
      const data = sctx.getImageData(0, 0, cols, rows).data;
      const full = reveal >= 1;
      for (let i = 0, n = cols * rows; i < n; i++) {
        let gi = -1, k = 0;
        let f = 1;
        if (!full) {
          f = (reveal - threshold[i]) / FADE;
          if (f > 1) f = 1;
        }
        if (f > 0) {
          const p = i << 2;
          const red = data[p], grn = data[p + 1], blu = data[p + 2];
          let l = (red * 77 + grn * 150 + blu * 29) >> 8;
          if (f < 1) l = (l * f) | 0;
          gi = glyphOf[l];
          if (gi >= 0) {
            if (red * f >= WHITE_MIN && grn * f >= WHITE_MIN && blu * f >= WHITE_MIN) {
              k = WHITE;
            } else if (grn * 16 > (red > blu ? red : blu) * 17 + 32) {
              // Hue test on the undimmed pixel: alien light stays lime while it fades.
              k = limeRow[l];
            } else {
              k = purpleRow[l];
            }
          }
        }
        cells[i * 2] = gi < 0 ? BLANK : gi;
        cells[i * 2 + 1] = k;
      }
    }

    function render2d(cols, rows) {
      ctx2d.setTransform(1, 0, 0, 1, 0, 0);
      ctx2d.globalAlpha = 1;
      ctx2d.globalCompositeOperation = 'source-over';
      ctx2d.fillStyle = bg;
      ctx2d.fillRect(0, 0, W, H);
      if (!cols || !rows) return;
      if (!textRows) {
        for (let w = 0, i = 0; w < rows; w++) {
          const dy = ys[w];
          for (let c = 0; c < cols; c++, i += 2) {
            const g = cells[i];
            if (g === BLANK) continue;
            ctx2d.drawImage(atlas, g * slotW, cells[i + 1] * slotH, slotW, slotH, xs[c], dy, slotW, slotH);
          }
        }
        return;
      }
      // One fillText per (colour, row) with spaces in the other cells: the monospace advance,
      // scaled to the cell width, puts each glyph in its column at ~720 canvas calls per 1080p
      // frame instead of one per cell.
      let all = 0;
      for (let w = 0, i = 0; w < rows; w++) {
        let m = 0;
        for (let c = 0; c < cols; c++, i += 2) {
          if (cells[i] !== BLANK) m |= 1 << cells[i + 1];
        }
        rowMask[w] = m;
        all |= m;
      }
      ctx2d.font = font2d;
      ctx2d.textBaseline = 'alphabetic';
      ctx2d.setTransform(textScale, 0, 0, 1, 0, 0);
      for (let k = 0; k < colors.length; k++) {
        const bit = 1 << k;
        if (!(all & bit)) continue;
        ctx2d.fillStyle = colors[k];
        for (let w = 0; w < rows; w++) {
          if (!(rowMask[w] & bit)) continue;
          let first = -1, last = 0;
          for (let c = 0, i = w * cols * 2; c < cols; c++, i += 2) {
            if (cells[i] !== BLANK && cells[i + 1] === k) {
              rowChars[c] = rampCodes[cells[i]];
              if (first < 0) first = c;
              last = c;
            } else {
              rowChars[c] = SPACE;
            }
          }
          if (ligSafe) {
            const text = String.fromCharCode.apply(null, rowChars.subarray(first, last + 1));
            ctx2d.fillText(text, first * advance2d, rowY[w]);
          } else {
            for (let parity = 0; parity < 2; parity++) {
              let s = '';
              for (let c = first; c <= last; c++) s += c % 2 === parity ? String.fromCharCode(rowChars[c]) : ' ';
              if (s.trim()) ctx2d.fillText(s, first * advance2d, rowY[w]);
            }
          }
        }
      }
    }

    function render(o) {
      const reveal = o && o.reveal !== undefined ? o.reveal : 1;
      const cols = r.cols, rows = r.rows;
      if (!W || !H || !owns()) return;
      if (cols && rows) classify(reveal);

      if (!gl) {
        render2d(cols, rows);
        return;
      }
      if (s.lost) return;
      if (cols && rows) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG_INTEGER, gl.UNSIGNED_BYTE, cells);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // The last rendered frame as text: glyphs by default, or colour buckets with mode 'color'.
    function dump(mode) {
      const lines = [];
      for (let w = 0, i = 0; w < r.rows; w++) {
        let line = '';
        for (let c = 0; c < r.cols; c++, i += 2) {
          const g = cells[i];
          line += g === BLANK ? ' ' : mode === 'color' ? bucketChars[cells[i + 1]] : ramp[g];
        }
        lines.push(line);
      }
      return lines.join('\n');
    }

    return r;
  }

  AsciiParts.createAsciiRenderer = createAsciiRenderer;
})();
