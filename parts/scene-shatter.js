// The fourth wall for the ASCII scroll scene: the screen itself cracks under knocks from outside, then
// blows inward in tumbling shards as the ship comes through. See parts/CONTRACT.md.
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

  // Crack web: rays out of the impact point crossed by rings, as fractions of the screen diagonal.
  // The shards are the cells between them, so the pane breaks exactly along the cracks it showed.
  const RAYS = 13;
  const RINGS = [0.05, 0.13, 0.27, 0.46, 0.72, 1.1];
  const CRACK_PX = 5; // about half a cell wide: thin, but always lands on some sample
  const GLASS = '205,195,255';
  const EDGE = '238,230,255';

  let cache = null;
  function planFor(w, h, x, y) {
    const key = `${w}x${h}@${Math.round(x)},${Math.round(y)}`;
    if (cache && cache.key === key) return cache;
    const D = Math.hypot(w, h);
    const ang = [];
    for (let i = 0; i < RAYS; i++) ang.push(((i + 0.6 * (hash(i, 1) - 0.5)) / RAYS) * TAU);
    // Vertices are shared by neighbouring shards and cracks, so the jitter is keyed by (ray, ring).
    const vert = (i, j) => {
      const k = i % RAYS;
      const r = RINGS[j] * D * (j === 0 ? 1 : 0.85 + 0.3 * hash(k, j + 7));
      const a = ang[k] + (j ? (hash(k, j + 13) - 0.5) * 0.14 : 0);
      return [x + Math.cos(a) * r, y + Math.sin(a) * r];
    };
    const shards = [];
    for (let j = 0; j < RINGS.length - 1; j++) {
      for (let i = 0; i < RAYS; i++) {
        const pts = [vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)];
        const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
        const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
        shards.push({
          pts: pts.map(([px, py]) => [px - cx, py - cy]),
          cx,
          cy,
          spin: (hash(i, j + 31) - 0.5) * 1.6, // half-turns in the screen plane over the burst
          tumble: 0.7 + 1.5 * hash(i, j + 47), // half-turns about an axis in the plane: the 3D flip
          phase: hash(i, j + 59) * TAU,
          speed: 0.3 + 0.7 * hash(i, j + 71),
        });
      }
    }
    // Small pieces first so the big near ones paint over them.
    shards.sort((a, b) => Math.hypot(a.pts[0][0], a.pts[0][1]) - Math.hypot(b.pts[0][0], b.pts[0][1]));
    cache = { key, D, x, y, vert, shards };
    return cache;
  }

  // The web grows outward with each knock: rays reach `reach` px from the impact, and a ring shows once
  // the rays have passed it.
  function drawCracks(ctx, p, k, alpha, hit = 0) {
    const reach = k * RINGS[RINGS.length - 1] * p.D;
    if (reach <= 0) return;
    const r = (v) => Math.hypot(v[0] - p.x, v[1] - p.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${EDGE},${(0.9 * alpha).toFixed(3)})`;
    ctx.lineWidth = CRACK_PX;
    ctx.beginPath();
    for (let i = 0; i < RAYS; i++) {
      let prev = p.vert(i, 0);
      ctx.moveTo(prev[0], prev[1]);
      for (let j = 1; j < RINGS.length; j++) {
        const v = p.vert(i, j);
        const rv = r(v);
        if (rv > reach) {
          const rp = r(prev);
          if (rp < reach) {
            const f = (reach - rp) / (rv - rp);
            ctx.lineTo(prev[0] + (v[0] - prev[0]) * f, prev[1] + (v[1] - prev[1]) * f);
          }
          break;
        }
        ctx.lineTo(v[0], v[1]);
        prev = v;
      }
    }
    for (let j = 0; j < RINGS.length; j++) {
      for (let i = 0; i < RAYS; i++) {
        const a = p.vert(i, j);
        const b = p.vert(i + 1, j);
        if (r(a) > reach || r(b) > reach) continue;
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
    }
    ctx.stroke();
    // The point of impact is crushed white glass, flaring as each knock lands.
    const R = RINGS[0] * p.D * (1 + 1.6 * hit);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, `rgba(${EDGE},${(Math.min(1, 0.95 + 0.05 * hit) * alpha).toFixed(3)})`);
    g.addColorStop(0.4, `rgba(${EDGE},${(0.5 * hit * alpha).toFixed(3)})`);
    g.addColorStop(1, `rgba(${GLASS},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, TAU);
    ctx.fill();
  }

  // crack: 0..1 how far the web has spread. burst: 0..1 the pane blowing inward after the ship.
  function drawShatter(ctx, w, h, o) {
    const crack = clamp01(o.crack || 0);
    const burst = clamp01(o.burst || 0);
    if (crack <= 0 && burst <= 0) return;
    const p = planFor(w, h, o.x, o.y);
    const a0 = ctx.globalAlpha;
    ctx.save();
    if (burst <= 0) {
      drawCracks(ctx, p, crack, 1, clamp01(o.hit || 0));
      ctx.restore();
      return;
    }
    if (o.reduced) {
      // No flying glass: the cracked pane simply fades away.
      drawCracks(ctx, p, 1, 1 - burst);
      ctx.restore();
      return;
    }

    // The pane gives all at once, then the pieces drift: an ease-out on the travel.
    const fly = 1 - Math.pow(1 - burst, 3);
    const fade = 1 - smoothstep(0.55, 1, burst);
    for (const s of p.shards) {
      const depth = 1 - 0.72 * fly; // blown inward, away from us: smaller as it recedes
      const dx = s.cx - p.x, dy = s.cy - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const spread = s.speed * 0.22 * p.D * fly;
      const x = p.x + dx * depth + (dx / d) * spread * depth;
      const y = p.y + dy * depth + (dy / d) * spread * depth + 0.45 * h * burst * burst * depth; // falling
      const turn = s.tumble * Math.PI * fly;
      const flip = Math.cos(turn); // foreshortening as the piece turns edge-on and back
      const glint = Math.pow(0.5 + 0.5 * Math.sin(turn + s.phase), 3); // catches the light as it turns
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s.spin * Math.PI * fly);
      // Never quite edge-on (a zero-width piece vanishes), but keep the side it is showing.
      ctx.scale(depth * (flip < 0 ? Math.min(flip, -0.06) : Math.max(flip, 0.06)), depth);
      ctx.beginPath();
      ctx.moveTo(s.pts[0][0], s.pts[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(s.pts[k][0], s.pts[k][1]);
      ctx.closePath();
      ctx.globalAlpha = a0 * fade;
      // Mostly clear glass: the face only lights up while the piece catches the light.
      ctx.fillStyle = `rgba(${GLASS},${(0.02 + 0.3 * glint * glint).toFixed(3)})`;
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = CRACK_PX / depth;
      ctx.strokeStyle = `rgba(${EDGE},${(0.45 + 0.5 * glint).toFixed(3)})`;
      ctx.stroke();
      ctx.restore();
    }
    // The flash where the hull came through, gone as the pieces clear.
    const flash = (1 - fly) * 0.85;
    if (flash > 0.01) {
      const R = RINGS[1] * p.D;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, `rgba(255,255,255,${(a0 * flash).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(p.x - R, p.y - R, 2 * R, 2 * R);
    }
    ctx.restore();
  }

  AP.drawShatter = drawShatter;
})();
