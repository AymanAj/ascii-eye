// Saucer and tractor beam for the ASCII scroll scene. See parts/CONTRACT.md.
(() => {
  const AP = (window.AsciiParts = window.AsciiParts || {});

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const TAU = Math.PI * 2;

  // ---------- saucer geometry, in units of the disc half-width ----------
  // Every detail here lands on cells ~7 x 12 px, so each band is at least about a row tall.
  const RIM_DIP = 0.07;   // the near rim sits below the far rim: we see the ship from slightly above
  const HULL_TOP = -0.2;  // upper hull height at the centre (hidden under the dome)
  const SKIRT = 0.11;     // band under the rim that carries the lights
  const BELLY = 0.25;     // underside depth at the centre
  const DOME = { y: -0.13, rx: 0.38, ry: 0.33 };
  const POD = { y: 0.22, rx: 0.26, ry: 0.12 }; // lower dome; its bottom is at y + 0.34 * size
  const RIM_LIGHTS = 26;  // around the whole rim; only the near half shows
  const KEY_PX = 12;      // CSS px of dark keyline outside the hull and dome: about a row, so it survives sampling
  const CHASE = 2.4;      // rad/s the brightest light travels along the rim

  // Disc centre around 0.16h, half-width min(0.22w, 0.3h) on landscape. Tall screens get a wider
  // share so the windows and lights still span whole cells; the share eases in to avoid a jump at square.
  function ufoAnchor(w, h) {
    const share = 0.22 + 0.18 * clamp01((1.25 - w / h) / 0.65);
    const size = Math.min(share * w, 0.3 * h);
    return { x: w / 2, y: Math.max(0.16 * h, 0.5 * size), size };
  }

  // The near half of the rim ellipse, left to right through its lowest point.
  const nearRim = (ctx, rx, ry, oy = 0) => ctx.ellipse(0, oy, rx, ry, 0, Math.PI, 0, true);

  // Dim lime to bright lime as "r,g,b". Green leads red by at least 1.5x at every level: the renderer
  // only calls a pixel lime while green clearly beats red and blue, including where a lamp only
  // partly covers a cell and mixes with the purple skirt.
  function lightRgb(level) {
    const r = Math.round(40 + 120 * level);
    const g = Math.round(95 + 160 * level);
    const b = Math.round(15 + 110 * level);
    return `${r},${g},${b}`;
  }
  const lightColour = (level) => `rgb(${lightRgb(level)})`;
  const LIGHTS_FADE = 0.1; // below this the lamps fade out by alpha, to reach a dark ship

  function drawUfo(ctx, w, h, o) {
    const size = o.size;
    if (!(size > 0)) return;
    const lights = clamp01(o.lights == null ? 1 : o.lights);
    const t = o.t || 0;
    const reduced = !!o.reduced;
    const px = 1 / size; // one CSS px in ship units, for the floors that keep details a cell big
    const a0 = ctx.globalAlpha; // the caller may be fading the whole ship

    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.bank) ctx.rotate(o.bank);
    ctx.scale(size, size);

    // Lower dome, partly tucked under the belly.
    let g = ctx.createLinearGradient(0, POD.y, 0, POD.y + POD.ry);
    g.addColorStop(0, '#5b5079');
    g.addColorStop(1, '#2c2442');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, POD.y, POD.rx, POD.ry, 0, 0, Math.PI);
    ctx.fill();

    // Belly: a shallow dark cone under the rim.
    g = ctx.createLinearGradient(0, 0, 0, BELLY);
    g.addColorStop(0, '#463c62');
    g.addColorStop(1, '#251e37');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.bezierCurveTo(-0.72, 0.14, -0.38, BELLY, 0, BELLY);
    ctx.bezierCurveTo(0.38, BELLY, 0.72, 0.14, 1, 0);
    ctx.closePath();
    ctx.fill();

    // Skirt: the dark band just under the rim, thinning to nothing at the tips.
    ctx.fillStyle = '#231c35';
    ctx.beginPath();
    nearRim(ctx, 1, RIM_DIP);
    ctx.ellipse(0, 0, 0.955, RIM_DIP + SKIRT, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();

    if (lights > 0) {
      // Lamps dim by colour, not by alpha: a see-through lime lamp over the purple hull mixes to a
      // pixel the renderer paints purple. Alpha only takes the last step down to a dark ship.
      ctx.globalAlpha = a0 * Math.min(1, lights / LIGHTS_FADE);

      // Pod lights and the emitter the beam comes out of.
      const podW = Math.max(0.06, 9 * px);
      const podH = Math.max(0.065, 15 * px);
      ctx.fillStyle = lightColour(0.75 * lights);
      for (let k = -1; k <= 1; k++) {
        ctx.fillRect(k * 0.13 - podW / 2, BELLY - 0.01, podW, podH);
      }
      ctx.save();
      ctx.translate(0, POD.y + POD.ry);
      ctx.scale(1, 0.4);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.16);
      g.addColorStop(0, `rgba(${lightRgb(0.95 * lights)},0.9)`);
      g.addColorStop(1, `rgba(${lightRgb(0.3 * lights)},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 0.16, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Rim lights: fixed lamps with a bright crest running along them, so the ship reads as spinning
      // without anything sliding across cells.
      const lw = Math.max(0.085, 12 * px);
      const lh = Math.max(0.09, 15 * px); // ~1.7 rows, so some row is always mostly lit
      const minW = 6 * px;
      for (let k = 0; k < RIM_LIGHTS; k++) {
        const th = ((k + 0.5) / RIM_LIGHTS) * TAU;
        if (th >= Math.PI) continue; // far side, hidden by the hull
        const s = Math.sin(th);
        const lx = -Math.cos(th) * 0.95;
        const ly = (RIM_DIP + SKIRT * 0.5) * s;
        const crest = Math.pow(0.5 + 0.5 * Math.cos(2 * th - CHASE * t), 4);
        const level = reduced ? 0.85 : 0.7 + 0.3 * crest;
        const wk = Math.max(lw * s, minW);
        const hk = Math.min(lh, Math.max(SKIRT * s * 1.1, 7 * px));
        ctx.fillStyle = lightColour(level * lights);
        ctx.fillRect(lx - wk / 2, ly - hk / 2, wk, hk);
      }
      ctx.globalAlpha = a0;
    }

    // Over a bright window the lit hull and dome melt into the glass. A dark keyline drawn under them
    // (so only its outer half shows) keeps the silhouette; the caller fades it out with the room's light.
    const key = clamp01(o.keyline || 0);
    if (key > 0) {
      ctx.globalAlpha = a0 * key;
      ctx.strokeStyle = '#05030a';
      ctx.lineWidth = 2 * KEY_PX * px;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-1, 0);
      ctx.bezierCurveTo(-0.66, -0.09, -0.36, HULL_TOP, 0, HULL_TOP);
      ctx.bezierCurveTo(0.36, HULL_TOP, 0.66, -0.09, 1, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, DOME.y, DOME.rx, DOME.ry, 0, Math.PI, 0);
      ctx.stroke();
      ctx.globalAlpha = a0;
    }

    // Upper hull, lit from above: dim toward the far side, bright toward the near rim.
    g = ctx.createLinearGradient(0, HULL_TOP, 0, RIM_DIP);
    g.addColorStop(0, '#5a4f80');
    g.addColorStop(0.6, '#9488c0');
    g.addColorStop(1, '#b2a7dd');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-1, 0);
    ctx.bezierCurveTo(-0.66, -0.09, -0.36, HULL_TOP, 0, HULL_TOP);
    ctx.bezierCurveTo(0.36, HULL_TOP, 0.66, -0.09, 1, 0);
    ctx.ellipse(0, 0, 1, RIM_DIP, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();

    // Rim highlight: the brightest metal, sitting on the hull's lower edge so it never covers the lights.
    const rimW = Math.min(0.12, Math.max(0.055, 12 * px));
    ctx.strokeStyle = '#d8c4ff'; // green under the renderer's white cut-off (200), so it stays purple metal
    ctx.lineWidth = rimW;
    ctx.beginPath();
    nearRim(ctx, 1 - rimW / 2, Math.max(0.005, RIM_DIP - rimW / 2));
    ctx.stroke();

    // Glass dome with a highlight up and to the left.
    g = ctx.createRadialGradient(-0.12, DOME.y - 0.22, 0.02, 0, DOME.y - 0.08, 0.5);
    g.addColorStop(0, '#dcc6ff'); // glass glint in purple: white is kept for light, not metal
    g.addColorStop(0.3, '#c0b3e6');
    g.addColorStop(0.75, '#7a6da6');
    g.addColorStop(1, '#5c5084');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, DOME.y, DOME.rx, DOME.ry, 0, Math.PI, 0);
    ctx.ellipse(0, DOME.y, DOME.rx, 0.03, 0, 0, Math.PI);
    ctx.fill();

    // Window slots, narrowing as the dome curves away.
    const winW = Math.max(0.08, 11 * px);
    const winH = Math.max(0.09, 16 * px);
    const winY = DOME.y - 0.12;
    ctx.fillStyle = '#120d1e';
    for (let k = -2; k <= 2; k++) {
      const a = k * 0.5;
      const wk = Math.max(winW * Math.cos(a), 7 * px);
      ctx.fillRect(DOME.rx * 0.8 * Math.sin(a) - wk / 2, winY - winH / 2, wk, winH);
    }

    ctx.restore();
  }

  // ---------- tractor beam ----------
  // Start it inside the lower dome (topY ~ ufo.y + 0.24 * size, topWidth ~ 0.5 * size): drawUfo runs
  // after drawBeam, so the ship hides the cone's flat top edge.
  const LINE_W = 8;     // CSS px: the closed beam is a line about one cell wide
  const CORE_W = 10;     // CSS px: a flat core ~1.4 cells wide, so some column is always lit
  const STRIP = 8;       // CSS px per horizontal slice; under a row, so the cone edge never steps
  // Light across the cone, centre to edge: [distance as a fraction of the half-width, r, g, b, alpha].
  // A broad lit body (it has to backlight the person) with a hot core and a soft rim. The dim stops
  // lean greener so the light still tips purple room pixels toward lime when added over them.
  // Every layer added here keeps red well under green: where stacked light clips both to 255 the
  // pixel stops being green-dominant and the renderer would paint it purple.
  const PROFILE = [
    [0, 215, 255, 170, 1],
    [0.08, 175, 250, 105, 0.95],
    [0.3, 135, 232, 40, 0.78],
    [0.55, 85, 196, 20, 0.62],
    [0.75, 50, 150, 12, 0.45],
    [0.9, 26, 82, 6, 0.3],
    [1, 14, 46, 4, 0],
  ];
  // Multiply tint under the light, centre to edge: [distance as a fraction of the half-width, alpha].
  // Added lime cannot turn an already near-white window green, so the cone first pulls red and blue
  // out of whatever it crosses. Over black it does nothing. Blue is kept a little above red so that,
  // where the hot core clips the window back toward white, blue reaches the renderer's white cut-off
  // before red outgrows green; otherwise the core gets a ring of cells that read as pale purple.
  const TINT = [[0, 0.9], [0.7, 0.75], [1, 0]];
  const TINT_RGB = '100,255,120';
  const MOTE_RX = 8, MOTE_RY = 12; // CSS px: a soft blob about a cell, so a rising mote fades across cells

  // A gradient across x = -1..1, mirrored about 0 from centre-to-edge stops [u, colour].
  function acrossGradient(ctx, stops) {
    const g = ctx.createLinearGradient(-1, 0, 1, 0);
    for (let i = stops.length - 1; i >= 0; i--) g.addColorStop((1 - stops[i][0]) / 2, stops[i][1]);
    for (let i = 1; i < stops.length; i++) g.addColorStop((1 + stops[i][0]) / 2, stops[i][1]);
    return g;
  }

  function drawBeam(ctx, w, h, o) {
    const len = o.bottomY - o.topY;
    const intensity = clamp01(o.intensity == null ? 1 : o.intensity);
    if (!(len > 0) || intensity <= 0) return;
    const open = clamp01(o.open == null ? 1 : o.open);
    const t = o.t || 0;
    const reduced = !!o.reduced;
    const x = o.x, topY = o.topY, bottomY = o.bottomY;
    const wTop = Math.max(LINE_W, LINE_W + (o.topWidth - LINE_W) * open);
    const wBot = Math.max(LINE_W, LINE_W + (o.bottomWidth - LINE_W) * open);
    const halfAt = (v) => (wTop + (wBot - wTop) * v) / 2;
    const a0 = ctx.globalAlpha; // the caller may be fading the whole beam

    ctx.save();
    // Each slice is the caller's matrix x translate(x, y0) x scale(half, 1), set directly: a hundred
    // save/restore pairs a frame would cost more than everything else here.
    const m = ctx.getTransform();
    const slice = (y0, half) =>
      ctx.setTransform(m.a * half, m.b * half, m.c, m.d, m.a * x + m.c * y0 + m.e, m.b * x + m.d * y0 + m.f);

    // Tint pass. Two slices sharing a source row would multiply it twice at partial coverage and leave
    // a paler stripe that crawls as the ship bobs, so with an axis-aligned camera the tint is cut
    // exactly at source-row edges, one slice per row.
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = a0 * intensity * (0.3 + 0.7 * open);
    ctx.fillStyle = acrossGradient(ctx, TINT.map(([u, a]) => [u, `rgba(${TINT_RGB},${a})`]));
    const aligned = m.b === 0 && m.c === 0 && m.d > 0;
    const rowH = aligned ? 1 / m.d : STRIP;
    const row0 = aligned ? (Math.floor(m.d * topY + m.f) - m.f) / m.d : topY;
    for (let k = 0; row0 + k * rowH < bottomY; k++) {
      const ya = Math.max(topY, row0 + k * rowH);
      const yb = Math.min(bottomY, row0 + (k + 1) * rowH);
      if (yb <= ya) continue;
      slice(ya, halfAt(((ya + yb) / 2 - topY) / len));
      ctx.fillRect(-1, 0, 2, yb - ya);
    }

    ctx.globalCompositeOperation = 'lighter'; // light adds; slices that share a cell sum without seams

    // One gradient in unit space (-1..1 across); each slice scales it to its own width.
    const g = acrossGradient(ctx, PROFILE.map(([u, r, gg, b, a]) => [u, `rgba(${r},${gg},${b},${a})`]));
    ctx.fillStyle = g;

    // Bands drift down at a steady pace; their spacing follows the beam so phones and desktops match.
    const period = Math.max(54, len / 7);
    const drift = t * period * 0.3;
    // A gradient narrower than two cells can fall between samples, so a flat core carries the closed
    // line and hands over to the cone's own hot centre as it opens. The cone dims while the core is
    // up so the two never stack to clipping.
    const core = 0.8 * (1 - open);
    const cone = 1 - 0.75 * (1 - open) * (1 - open);
    const coreFill = 'rgb(120,255,40)';
    const n = Math.max(8, Math.ceil(len / STRIP));
    const sh = len / n;
    for (let i = 0; i < n; i++) {
      const v = (i + 0.5) / n;
      const y0 = topY + i * sh;
      let a = intensity * (1 - 0.25 * v) * (1 - 0.6 * smoothstep(0.96, 1, v));
      if (!reduced) {
        const b = 0.5 + 0.5 * Math.sin(((v * len - drift) / period) * TAU);
        a *= 0.88 + 0.24 * b * b;
      }
      const half = halfAt(v);
      slice(y0, half);
      ctx.globalAlpha = a0 * Math.min(1, a * cone);
      ctx.fillRect(-1, 0, 2, sh);
      if (core > 0) {
        const cu = CORE_W / 2 / half;
        ctx.globalAlpha = a0 * Math.min(1, a * core);
        ctx.fillStyle = coreFill;
        ctx.fillRect(-cu, 0, 2 * cu, sh);
        ctx.fillStyle = g;
      }
    }
    ctx.setTransform(m);

    // Pool where the beam lands.
    const poolA = intensity * (0.35 + 0.65 * open);
    const rx = wBot * 0.56;
    const ry = Math.max(10, wBot * 0.06);
    const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    pg.addColorStop(0, 'rgba(130,240,60,0.55)');
    pg.addColorStop(0.6, 'rgba(90,190,25,0.25)');
    pg.addColorStop(1, 'rgba(40,98,10,0)');
    ctx.globalAlpha = a0 * poolA;
    ctx.fillStyle = pg;
    ctx.save();
    ctx.translate(x, bottomY);
    ctx.scale(rx, ry);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Motes rise through the cone: the cue that it lifts. Seeded per index, positioned from t alone.
    // Each is a soft blob, not a hard dot: a hard edge crossing a cell boundary flips the glyph on
    // single frames, a soft one brightens and dims the cells it passes through.
    const moteA = intensity * smoothstep(0.3, 0.9, open);
    if (!reduced && moteA > 0) {
      const count = Math.round(Math.min(40, Math.max(10, len / 18)));
      const mg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      mg.addColorStop(0, 'rgba(120,255,70,1)');
      mg.addColorStop(0.5, 'rgba(120,255,70,0.6)');
      mg.addColorStop(1, 'rgba(120,255,70,0)');
      ctx.fillStyle = mg;
      for (let i = 0; i < count; i++) {
        const speed = 0.055 + 0.05 * hash(i, 2); // beam lengths per second
        const p = hash(i, 3) + t * speed;
        const v = 1 - (p - Math.floor(p));
        const fade = smoothstep(0, 0.22, v) * (1 - smoothstep(0.82, 1, v));
        if (fade <= 0) continue;
        // Keep motes out of the hot core, where they'd vanish into the glare.
        const r = hash(i, 1) * 2 - 1;
        const u = Math.sign(r || 1) * (0.2 + 0.6 * Math.abs(r));
        const sway = 0.04 * Math.sin(t * 0.7 + i * 1.7);
        const mx = x + (u + sway) * halfAt(v);
        const my = topY + v * len;
        ctx.globalAlpha = a0 * Math.min(1, moteA * fade * (0.32 + 0.3 * hash(i, 4)));
        // translate(mx, my) x scale(MOTE_RX, MOTE_RY); the gradient resolves under this matrix at fill.
        ctx.setTransform(m.a * MOTE_RX, m.b * MOTE_RX, m.c * MOTE_RY, m.d * MOTE_RY,
          m.a * mx + m.c * my + m.e, m.b * mx + m.d * my + m.f);
        ctx.fillRect(-1, -1, 2, 2);
      }
      ctx.setTransform(m);
    }

    ctx.restore();
  }

  AP.ufoAnchor = ufoAnchor;
  AP.drawUfo = drawUfo;
  AP.drawBeam = drawBeam;
})();
