// Room and levitating person for the ASCII scroll scene. Interface: parts/CONTRACT.md.
(() => {
  const parts = (window.AsciiParts = window.AsciiParts || {});

  const DEG = Math.PI / 180;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smoothstep = (a, b, x) => {
    const k = clamp01((x - a) / (b - a));
    return k * k * (3 - 2 * k);
  };
  const mix = (c1, c2, k) =>
    `rgb(${Math.round(lerp(c1[0], c2[0], k))},${Math.round(lerp(c1[1], c2[1], k))},${Math.round(lerp(c1[2], c2[2], k))})`;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // ---------- palette (source colours; the renderer maps them to glyphs) ----------
  const WALL = [8, 5, 15]; // safely below the first glyph, so unlit wall stays empty
  const SPILL = [150, 118, 232];
  const GLASS_TOP = [246, 241, 255];
  const GLASS_BOT = [222, 210, 250];
  const WHITE = [255, 255, 255];
  const SHEER = [128, 110, 186];
  const MULLION = [44, 28, 88];
  const FOLD_SHADE = [70, 44, 140];
  const DRAPE_DARK = [10, 6, 20];
  const DRAPE_LIT = [112, 86, 182];
  const BED_TOP = [44, 32, 74];
  const BED_LIT = [196, 176, 255];
  const BED_FRONT = [24, 16, 40];
  const SILHOUETTE = '#07040c';
  const RIM_DARK = [110, 81, 168];
  const RIM_LIT = [79, 143, 28]; // a lime rim of similar brightness, for when the beam backlights the body
  const RIM_PX = 10; // rim outside the silhouette in CSS px: about one cell, so it survives sampling

  // ---------- layout shared by the room and the person ----------
  function layout(w, h) {
    const portrait = 1 - smoothstep(0.6, 1, w / h);
    const len = Math.min(0.62 * h, w * lerp(0.5, 0.8, portrait));
    // Every limb has to stay in front of the glass to read as a backlit cut-out, so the window
    // never gets narrower than the body.
    const winW = Math.min(0.9 * w, Math.max(0.42 * w, 1.12 * len));
    return {
      len,
      winX: (w - winW) / 2,
      winY: 0.06 * h,
      winW,
      winH: 0.68 * h,
      bedY: 0.8 * h,
      px: w / 2,
      py: 0.47 * h,
    };
  }

  function personAnchor(w, h) {
    const L = layout(w, h);
    return { x: L.px, y: L.py, scale: L.len };
  }

  // Soft vertical folds: a horizontal gradient of shade bands. Each band is several cells wide so the
  // folds survive one sample per cell.
  function foldGradient(ctx, x0, x1, period, shift, colour, depth) {
    const span = x1 - x0 + 2 * period;
    const g = ctx.createLinearGradient(x0 - period + shift, 0, x0 - period + shift + span, 0);
    const steps = Math.ceil(span / period) * 4;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const a = depth * (0.5 - 0.5 * Math.cos(((u * span) / period) * Math.PI * 2));
      g.addColorStop(u, rgba(colour, a.toFixed(3)));
    }
    return g;
  }

  function drapePath(ctx, side, L, w, h) {
    const { winX, winY, winW, bedY } = L;
    const cw = Math.max(0.15 * w, 0.07 * h);
    const edge = side < 0 ? winX : winX + winW;
    const top = winY - 0.035 * h;
    const bottom = bedY + 0.06 * h;
    const H = bottom - top;
    const tieY = top + 0.64 * H;
    // x measured inward (toward the window) from the window edge
    const X = (d) => edge - side * d;
    const outer = X(-cw);
    const innerTop = X(0.1 * cw);
    const tie = X(-0.32 * cw);
    const foot = X(-0.04 * cw);
    ctx.beginPath();
    ctx.moveTo(outer, top);
    ctx.lineTo(innerTop, top);
    ctx.bezierCurveTo(innerTop, top + 0.32 * H, X(-0.22 * cw), tieY - 0.1 * H, tie, tieY);
    ctx.bezierCurveTo(X(-0.36 * cw), tieY + 0.08 * H, foot, bottom - 0.12 * H, foot, bottom);
    ctx.lineTo(outer, bottom);
    ctx.closePath();
    return { outer, inner: innerTop, cw, top, bottom, tieY };
  }

  function drawRoom(ctx, w, h, opts = {}) {
    const { t = 0, reduced = false, glow = 0 } = opts;
    const gl = clamp01(glow);
    const L = layout(w, h);
    const { winX, winY, winW, winH, bedY } = L;
    const cx = winX + winW / 2;
    const cy = winY + winH * 0.45;

    ctx.save();

    // Wall, overscanned so a camera pulling back never reaches the canvas edge.
    ctx.fillStyle = rgba(WALL, 1);
    ctx.fillRect(-w, -h, 3 * w, 3 * h);

    // Window light spilling onto the wall, stretched to the window's tall shape.
    const reach = Math.max(winW, winH) * (0.75 + 0.5 * gl);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Math.max(0.75, winW / winH) * 1.15, 1);
    const spill = ctx.createRadialGradient(0, 0, reach * 0.25, 0, 0, reach);
    spill.addColorStop(0, rgba(SPILL, (0.36 + 0.44 * gl).toFixed(3)));
    spill.addColorStop(0.45, rgba(SPILL, (0.13 + 0.27 * gl).toFixed(3)));
    spill.addColorStop(0.75, rgba(SPILL, (0.04 + 0.1 * gl).toFixed(3)));
    spill.addColorStop(1, rgba(SPILL, 0));
    ctx.fillStyle = spill;
    ctx.fillRect(-2 * reach, -2 * reach, 4 * reach, 4 * reach);
    ctx.restore();

    // Sheer curtain hanging from the rod to the bed; lit from behind, so it glows where the glass is.
    const sheerPad = 0.06 * winW;
    const sx0 = winX - sheerPad;
    const sx1 = winX + winW + sheerPad;
    const sy0 = winY - 0.03 * h;
    const sy1 = bedY + 0.04 * h;
    ctx.fillStyle = mix(SHEER, WHITE, 0.25 * gl);
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);

    // Glass: the brightest area in the room. Glow pushes it to pure white.
    const glass = ctx.createLinearGradient(0, winY, 0, winY + winH);
    glass.addColorStop(0, mix(GLASS_TOP, WHITE, gl));
    glass.addColorStop(0.55, mix(GLASS_TOP, WHITE, 0.4 + 0.6 * gl));
    glass.addColorStop(1, mix(GLASS_BOT, WHITE, gl));
    ctx.fillStyle = glass;
    ctx.fillRect(winX, winY, winW, winH);

    // Mullions and frame: about one cell thick, in a mid tone so the black body still owns the darkest
    // value against the window.
    const mw = Math.max(9, 0.012 * w);
    const mh = Math.max(13, 0.018 * h);
    ctx.fillStyle = rgba(MULLION, (0.62 - 0.4 * gl).toFixed(3));
    for (const f of [1 / 3, 2 / 3]) ctx.fillRect(winX + winW * f - mw / 2, winY, mw, winH);
    // Transoms sit above and below the body so the hands and head stay against clear glass.
    for (const f of [0.3, 0.9]) ctx.fillRect(winX, winY + winH * f - mh / 2, winW, mh);
    ctx.fillRect(winX - mw, winY - mh, winW + 2 * mw, mh);
    ctx.fillRect(winX - mw, winY + winH, winW + 2 * mw, mh);
    ctx.fillRect(winX - mw, winY, mw, winH);
    ctx.fillRect(winX + winW, winY, mw, winH);

    // Sheer folds over everything inside the curtain. A breeze drifts them a fraction of a fold.
    const period = Math.max(5 * mw, winW / 9);
    const drift = reduced ? 0 : (0.2 * Math.sin(t * 0.31) + 0.08 * Math.sin(t * 0.53 + 1.3)) * period;
    ctx.fillStyle = foldGradient(ctx, sx0, sx1, period, drift, FOLD_SHADE, 0.24 - 0.12 * gl);
    ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);

    // Heavy curtains with vertical folds, catching light on the edge nearest the window.
    for (const side of [-1, 1]) {
      const d = drapePath(ctx, side, L, w, h);
      ctx.save();
      ctx.clip();
      const x0 = Math.min(d.outer, d.inner);
      const x1 = Math.max(d.outer, d.inner);
      ctx.fillStyle = rgba(DRAPE_DARK, 1);
      ctx.fillRect(x0 - d.cw, d.top, x1 - x0 + 2 * d.cw, d.bottom - d.top);
      ctx.fillStyle = foldGradient(ctx, x0, x1, d.cw / 3.2, side * d.cw * 0.13, DRAPE_LIT, 1);
      ctx.fillRect(x0 - d.cw, d.top, x1 - x0 + 2 * d.cw, d.bottom - d.top);
      const lit = ctx.createLinearGradient(d.inner, 0, d.outer, 0);
      lit.addColorStop(0, rgba(SPILL, (0.32 + 0.3 * gl).toFixed(3)));
      lit.addColorStop(0.55, rgba(SPILL, (0.06 + 0.1 * gl).toFixed(3)));
      lit.addColorStop(1, rgba(SPILL, 0));
      ctx.fillStyle = lit;
      ctx.fillRect(x0 - d.cw, d.top, x1 - x0 + 2 * d.cw, d.bottom - d.top);
      // Shade below the tie-back where the fabric bunches.
      const bunch = ctx.createLinearGradient(0, d.tieY - 0.04 * h, 0, d.tieY + 0.05 * h);
      bunch.addColorStop(0, rgba(WALL, 0));
      bunch.addColorStop(0.5, rgba(WALL, 0.55));
      bunch.addColorStop(1, rgba(WALL, 0));
      ctx.fillStyle = bunch;
      ctx.fillRect(x0 - d.cw, d.top, x1 - x0 + 2 * d.cw, d.bottom - d.top);
      ctx.restore();
    }

    // Bed across the bottom: a lit top surface in slight perspective over a dark front face.
    const bx0 = 0.03 * w;
    const bx1 = 0.97 * w;
    const inset = 0.025 * w;
    const depth = 0.075 * h;
    const frontY = bedY + depth;
    ctx.fillStyle = rgba(BED_FRONT, 1);
    ctx.fillRect(bx0, frontY, bx1 - bx0, 2 * h);
    const face = ctx.createLinearGradient(0, frontY, 0, h);
    face.addColorStop(0, rgba(BED_LIT, (0.16 + 0.12 * gl).toFixed(3)));
    face.addColorStop(1, rgba(BED_LIT, 0));
    ctx.fillStyle = face;
    ctx.fillRect(bx0, frontY, bx1 - bx0, h - frontY);

    ctx.beginPath();
    ctx.moveTo(bx0 + inset, bedY);
    ctx.lineTo(bx1 - inset, bedY);
    ctx.lineTo(bx1, frontY);
    ctx.lineTo(bx0, frontY);
    ctx.closePath();
    ctx.fillStyle = rgba(BED_TOP, 1);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // The pool of window light on the covers.
    ctx.translate(cx, bedY + depth * 0.45);
    ctx.scale(1, 0.18);
    const pool = winW * (0.85 + 0.25 * gl);
    const patch = ctx.createRadialGradient(0, 0, 0, 0, 0, pool);
    patch.addColorStop(0, rgba(BED_LIT, (0.62 + 0.3 * gl).toFixed(3)));
    patch.addColorStop(0.6, rgba(BED_LIT, (0.28 + 0.2 * gl).toFixed(3)));
    patch.addColorStop(1, rgba(BED_LIT, 0));
    ctx.fillStyle = patch;
    ctx.fillRect(-2 * pool, -2 * pool, 4 * pool, 4 * pool);
    ctx.restore();

    // A pillow at the head end, so the slab reads as a bed.
    const pw = Math.max(0.15 * w, 0.1 * winW + 40);
    const ph = 0.06 * h;
    const px = bx0 + inset + 0.015 * w;
    const py = bedY - 0.022 * h;
    const pillow = ctx.createLinearGradient(px + pw, 0, px, 0);
    pillow.addColorStop(0, mix(BED_TOP, BED_LIT, 0.42 + 0.2 * gl));
    pillow.addColorStop(1, mix(BED_TOP, BED_LIT, 0.16 + 0.1 * gl));
    ctx.fillStyle = pillow;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, ph * 0.45);
    else ctx.rect(px, py, pw, ph);
    ctx.fill();

    ctx.restore();
  }

  // ---------- person ----------
  const at = (p, ang, len) => [p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len];

  // A tapered limb segment with round ends, in body units.
  function limb(ctx, p, q, w0, w1) {
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const nx = -Math.sin(a), ny = Math.cos(a);
    ctx.moveTo(p[0] + nx * w0 / 2, p[1] + ny * w0 / 2);
    ctx.lineTo(q[0] + nx * w1 / 2, q[1] + ny * w1 / 2);
    ctx.arc(q[0], q[1], w1 / 2, a + Math.PI / 2, a - Math.PI / 2, true);
    ctx.lineTo(p[0] - nx * w0 / 2, p[1] - ny * w0 / 2);
    ctx.arc(p[0], p[1], w0 / 2, a - Math.PI / 2, a + Math.PI / 2, true);
    ctx.closePath();
  }

  function oval(ctx, c, rx, ry, rot) {
    ctx.moveTo(c[0] + Math.cos(rot) * rx, c[1] + Math.sin(rot) * rx);
    ctx.ellipse(c[0], c[1], rx, ry, rot, 0, Math.PI * 2);
  }

  // Torso thickness along the spine, hips (0) to shoulders (1).
  // Widths are in skeleton units; times BODY they land near the brief (torso ~0.18, thigh ~0.16,
  // shin ~0.11, arm ~0.07 of body length).
  const TORSO = [[0, 0.185], [0.42, 0.16], [0.78, 0.205], [1, 0.18]];
  const torsoWidth = (s) => {
    for (let i = 1; i < TORSO.length; i++) {
      if (s <= TORSO[i][0]) {
        const [s0, w0] = TORSO[i - 1];
        const [s1, w1] = TORSO[i];
        return lerp(w0, w1, smoothstep(s0, s1, s));
      }
    }
    return TORSO[TORSO.length - 1][1];
  };

  // Joint angles in degrees as [resting, lifted]; 0 points right, 90 points down. Head is on the
  // left, feet on the right, like the reference.
  const POSE = {
    spine: [163, 168],
    arch: [0.055, 0.042],
    neck: [124, 140],
    armNear: [[58, 43], [44, 28]],
    armFar: [[64, 49], [50, 34]],
    // Feet hang limp, drooping down-right at rest and drifting toward horizontal as the body floats.
    legNear: [[31, 26], [88, 74], [24, 10]],
    legFar: [[25, 21], [78, 64], [8, -2]],
  };
  // Segment lengths in skeleton units. Measured along the body, crown to heel, the skeleton is about
  // 1.1 long; BODY brings that close to `scale`.
  const SPINE = 0.36, NECK = 0.2, UPPER_ARM = 0.19, FOREARM = 0.17;
  const THIGH = 0.25, SHIN = 0.2, FOOT = 0.13;
  const BODY = 0.92;

  function drawPerson(ctx, w, h, opts = {}) {
    const { x = w / 2, y = h / 2, scale = Math.min(w, h) * 0.5, lift = 0, rimLight = 0, t = 0, reduced = false } = opts;
    // The caller already eases lift; a second curve here would compress the pose change into a snap.
    const k = clamp01(lift);
    const ph = t * 0.75; // one slow sway about every 8 s
    // Limbs follow the torso with a phase lag, the way they trail in water.
    const sway = (lag, deg) => (reduced ? 0 : deg * DEG * Math.sin(ph - lag));
    const ang = (pair) => lerp(pair[0], pair[1], k) * DEG;

    // Placed so the resting silhouette is centred on (x, y).
    const hip = [0.05, -0.177];
    const spineA = ang(POSE.spine) + sway(0.2, 0.8);
    const shoulder = at(hip, spineA, SPINE);
    const arch = lerp(POSE.arch[0], POSE.arch[1], k);
    // Quadratic spine bowing upward (toward -y). The control point sits near the hip end so the top of
    // the arch is over the pelvis, and at twice the bow height because a quadratic only reaches half.
    const ctrl = [
      lerp(hip[0], shoulder[0], 0.4) - 2 * arch * Math.sin(spineA),
      lerp(hip[1], shoulder[1], 0.4) + 2 * arch * Math.cos(spineA),
    ];

    const neckA = ang(POSE.neck) + sway(0.9, 3);
    const head = at(shoulder, neckA, NECK);

    const armRoot = at(shoulder, spineA + Math.PI, 0.02);
    const arm = (pair, lag) => {
      const elbow = at(armRoot, ang(pair[0]) + sway(lag, 4), UPPER_ARM);
      const foreA = ang(pair[1]) + sway(lag + 0.4, 5);
      const wrist = at(elbow, foreA, FOREARM);
      return { elbow, wrist, hand: at(wrist, foreA, 0.035), foreA };
    };
    const leg = (pair, lag) => {
      const knee = at(hip, ang(pair[0]) + sway(lag, 1.5), THIGH);
      const ankle = at(knee, ang(pair[1]) + sway(lag + 0.5, 3), SHIN);
      const footA = ang(pair[2]) + sway(lag + 0.9, 4);
      return { knee, ankle, heel: at(ankle, footA + Math.PI, 0.025), toe: at(ankle, footA, FOOT) };
    };
    const armN = arm(POSE.armNear, 1.0);
    const armF = arm(POSE.armFar, 1.2);
    const legN = leg(POSE.legNear, 0.5);
    const legF = leg(POSE.legFar, 0.7);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway(0, 0.6));
    ctx.scale(scale * BODY, scale * BODY);
    // One path per part: the parts have mixed winding, and a single nonzero fill would punch holes
    // where they overlap.
    const shapes = [];
    const part = (draw) => shapes.push(draw);

    // Torso: sampled along the bowed spine with a width profile (round hips, slimmer waist, deep chest).
    part(() => {
      const N = 12;
      const back = [];
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const u = 1 - s;
        const px = u * u * hip[0] + 2 * u * s * ctrl[0] + s * s * shoulder[0];
        const py = u * u * hip[1] + 2 * u * s * ctrl[1] + s * s * shoulder[1];
        const tx = 2 * u * (ctrl[0] - hip[0]) + 2 * s * (shoulder[0] - ctrl[0]);
        const ty = 2 * u * (ctrl[1] - hip[1]) + 2 * s * (shoulder[1] - ctrl[1]);
        const tl = Math.hypot(tx, ty) || 1;
        const half = torsoWidth(s) / 2;
        ctx.lineTo(px - (ty / tl) * half, py + (tx / tl) * half);
        back.push([px + (ty / tl) * half, py - (tx / tl) * half]);
      }
      for (let i = N; i >= 0; i--) ctx.lineTo(back[i][0], back[i][1]);
      ctx.closePath();
    });
    part(() => oval(ctx, hip, TORSO[0][1] / 2, TORSO[0][1] / 2, 0));
    part(() => oval(ctx, shoulder, 0.085, 0.085, 0));

    // A neck thinner than the head keeps the head reading as a round knob at ASCII resolution.
    part(() => limb(ctx, shoulder, at(shoulder, neckA, NECK * 0.7), 0.07, 0.06));
    part(() => oval(ctx, head, 0.084, 0.072, neckA));

    for (const a of [armF, armN]) {
      part(() => limb(ctx, armRoot, a.elbow, 0.076, 0.065));
      part(() => limb(ctx, a.elbow, a.wrist, 0.065, 0.054));
      part(() => oval(ctx, a.hand, 0.047, 0.034, a.foreA));
    }
    for (const l of [legF, legN]) {
      part(() => limb(ctx, hip, l.knee, 0.175, 0.13));
      part(() => limb(ctx, l.knee, l.ankle, 0.12, 0.08));
      part(() => limb(ctx, l.heel, l.toe, 0.07, 0.048));
    }

    // Rim first, every part, then the cut-out over it, so only the outer half of each stroke survives
    // and no rim shows where limbs cross the body. 'lighten' keeps the brighter of each channel: the rim
    // vanishes against the glass, leaves the beam lime, and outlines the body once the room goes dark.
    ctx.globalCompositeOperation = 'lighten';
    ctx.strokeStyle = mix(RIM_DARK, RIM_LIT, clamp01(rimLight));
    ctx.lineJoin = 'round';
    ctx.lineWidth = (2 * RIM_PX) / (scale * BODY);
    for (const draw of shapes) {
      ctx.beginPath();
      draw();
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = SILHOUETTE;
    for (const draw of shapes) {
      ctx.beginPath();
      draw();
      ctx.fill();
    }
    ctx.restore();
  }

  parts.drawRoom = drawRoom;
  parts.personAnchor = personAnchor;
  parts.drawPerson = drawPerson;
})();
