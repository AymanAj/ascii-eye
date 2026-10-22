# ASCII scroll scene: module contract

The page `ascii-eye.html` gets a scroll story. Scrolling dives through the eye's pupil into an ASCII
scene: a person levitating above a bed in front of a bright window, an alien saucer flying in from the
side, and a light beam that lifts the person, ending in light. The orchestrator (scroll timeline, eye
dive, wiring) is written separately. This file fixes the interfaces the scene modules must follow.

## Files and namespace

Plain scripts (no ES modules, no imports, no build step). Each file attaches to one global namespace:

```js
window.AsciiParts = window.AsciiParts || {};
```

| File | Exports on `AsciiParts` |
| --- | --- |
| `parts/ascii-canvas.js` | `createAsciiRenderer` |
| `parts/scene-room.js` | `drawRoom`, `drawPerson`, `personAnchor` |
| `parts/scene-ufo.js` | `drawUfo`, `drawBeam`, `ufoAnchor` |
| `parts/scene-shatter.js` | `drawShatter` |

```js
// The screen as glass (the fourth wall): drawn last, in front of everything, without the room camera.
AsciiParts.drawShatter(ctx, w, h, {
  x, y,          // CSS px impact point
  crack,         // 0..1 how far the crack web has spread from the impact
  hit,           // 0..1 optional flare at the impact while a knock lands
  burst,         // 0..1 the pane blowing inward in tumbling shards (0 = still whole)
  reduced,       // no flying shards: the cracked pane fades instead
})
```

The final page inlines these files into one `<script>`, so keep each file self-contained, wrap private
helpers in an IIFE, and do not depend on any other file except through `window.AsciiParts`.

## How a frame is drawn

1. `const ctx = renderer.begin()` returns a 2D context for a hidden **source canvas that has one pixel per
   ASCII cell**. It is cleared to black and pre-transformed so that **1 unit = 1 CSS pixel of the
   viewport** (`w` x `h`). Scene code draws in CSS pixels and never thinks about cells.
2. The orchestrator calls `drawRoom`, `drawBeam`, `drawPerson`, `drawUfo` (in that order, back to front)
   on that context, inside its own `save()/translate/scale/restore()` for camera moves.
3. `renderer.render({ reveal })` reads the source pixels and paints glyphs onto the visible canvas.

Because the source canvas is tiny (about 180 x 70 px at 1280 x 800), drawing is cheap, but each
cell is one sample: **thin details under ~1 cell (~7 px wide, ~12 px tall) vanish or flicker**. Design
shapes with that in mind: bold silhouettes, thick strokes, broad gradients.

## How pixels become glyphs (renderer behaviour scene code relies on)

- **Luminance picks the glyph** from a density ramp (blank for black, dense for bright). Black = empty.
- **Hue picks the colour family**: green-dominant pixels (alien light, e.g. `#a3e635`) render lime;
  near-white pixels render white; everything else renders in the purple family. So: draw the room
  and person in purple-ish hues (red approx. blue, green lower), draw alien light in lime, and draw the
  hottest light near white.
- `reveal` (0..1) dissolves the whole frame in and out grain by grain (per-cell threshold).

## Palette (match the page)

| Token | Value | Use |
| --- | --- | --- |
| page background | `#0b0714` | canvas background behind glyphs |
| purple glyphs, dim to bright | `#3d2b63`, `#6e51a8`, `#a98be6`, `#e2d6ff` | room, person rim, ship metal |
| lime glyphs, dim to bright | `#3f6212`, `#7cc22e`, `#c7f37a` | beam, ship lights |
| white | `#ffffff` | brightest light |
| iris lime (page) | `#a3e635` | reference hue for "alien light" |

Source-canvas colours are what you draw with; the glyph palette above is what the renderer paints.

## Function signatures

All draw functions are **pure functions of their arguments**: no globals, no `Math.random()` per frame
(use a seeded hash if you need noise), no `getImageData`, no DOM access. `t` is time in seconds, used
only for subtle ambient motion. `reduced: true` means `prefers-reduced-motion`: drop ambient movement
(sway, bob, chasing lights, moving bands), keep static light and colour.

```js
// Room: dark wall, a tall bright window behind the bed (mullion grid, sheer curtain, light glow),
// heavy curtains with folds on both sides, a bed across the bottom.
AsciiParts.drawRoom(ctx, w, h, { t, reduced, glow /* 0..1 extra window glow, default 0 */ })

// Where the person floats by default: in front of the window, above the bed.
AsciiParts.personAnchor(w, h) // -> { x, y, scale }
// Person silhouette, backlit (near-black against the window), arched backwards like the reference:
// hips highest, back arching down to the head which hangs lowest on one side, arms hanging down,
// knees bent with lower legs and feet hanging on the other side.
AsciiParts.drawPerson(ctx, w, h, {
  x, y,          // CSS px of the body's centre of mass
  scale,         // CSS px for the body's overall length (head to feet), from personAnchor
  lift,          // 0..1 (caller eases this): 0 = resting arch; 1 = being pulled up (arms and head float a
                 //   little upward, body tilts slightly toward horizontal). Position is NOT moved by lift;
                 //   the caller moves x/y.
  rimLight,      // 0..1 optional: blends the rim from dim purple to lime when the beam backlights the body
  t, reduced,
})

// Final hover spot of the ship, above the person.
AsciiParts.ufoAnchor(w, h) // -> { x, y, size }
// Classic saucer: wide disc with a bright rim, glass dome on top with small windows, smaller dome
// underneath, a row of rim lights that chase. Lit metal in purple-greys, lights in lime.
AsciiParts.drawUfo(ctx, w, h, {
  x, y,          // CSS px of the disc centre
  size,          // CSS px half-width of the disc
  bank,          // radians, roll while flying (positive = right side down)
  lights,        // 0..1 rim-light brightness (0 = dark ship)
  keyline,       // 0..1 optional dark edge around the hull and dome, for when the ship crosses bright glass
  t, reduced,
})
// Tractor beam: a cone from under the ship to the floor, lime light, brighter at the core,
// soft edges, horizontal bands drifting downward and motes drifting upward (the "lift" cue).
AsciiParts.drawBeam(ctx, w, h, {
  x,             // centre x of the beam
  topY, bottomY, // CSS px
  topWidth, bottomWidth, // CSS px full widths at top and bottom
  open,          // 0..1: the cone grows from a thin line to full width (caller eases this)
  intensity,     // 0..1: brightness
  t, reduced,
})

// Renderer
const r = AsciiParts.createAsciiRenderer(canvasEl, {
  fontFamily, fontSize,      // e.g. '"JetBrains Mono", ui-monospace, monospace', 12
  ramp,                      // density ramp, darkest to brightest, e.g. ' .,:;=+*#%@'
  palette: { bg, purple: [4 colours], lime: [3 colours], white },
});
r.resize(cssWidth, cssHeight, devicePixelRatio) // rebuild grid, source canvas and glyph atlas
const ctx = r.begin()                           // see "How a frame is drawn"
r.render({ reveal = 1 })                        // paint glyphs
r.cols; r.rows; r.cellW; r.cellH                // grid info (CSS px)
```

## Layout guidance (all relative to w, h so it works from 390 x 844 phones to 1920 x 1080 desktops)

- Window: centred horizontally, top around `0.06h`, height around `0.62h`, width around `0.42w`
  on landscape, wider share on portrait. The window is the brightest thing in the room.
- Bed: top surface around `0.80h`, spanning nearly the full width, slightly lighter than the wall.
- Person: centred in front of the window, floating clearly above the bed; body length about
  `min(0.5w, 0.62h)` on landscape and `0.8w` on portrait.
- Ship hover spot: centred above the person, disc centre around `0.16h`, half-width about
  `min(0.22w, 0.3h)` (wider share on portrait).
- Beam: from just under the ship's lower dome to the bed, wider at the bottom than the top, wide
  enough to contain the person.

## Reference images

The user supplied two references. Match their composition and silhouette, draw original shapes:
- Levitating person: `C:\Users\ayman\AppData\Local\Temp\claude\C--Users-ayman-AppData-Roaming-Claude-scratch-workspaces-842001c9-8c90-4bce-be00-2c7ef3c1223f-93595601-2f64-4266-9913-77daab761349-scratch-2026-10-22-3a606c\c0daec42-a98e-4e20-8361-3840c2ed4dfa\images\2.jpg`
- Saucer: `C:\Users\ayman\AppData\Local\Temp\claude\C--Users-ayman-AppData-Roaming-Claude-scratch-workspaces-842001c9-8c90-4bce-be00-2c7ef3c1223f-93595601-2f64-4266-9913-77daab761349-scratch-2026-10-22-3a606c\c0daec42-a98e-4e20-8361-3840c2ed4dfa\images\3.jpg`

Never embed or trace the reference image files; draw with canvas paths and gradients.

## Testing

A local server serves the project folder at `http://localhost:5317/`. The in-app browser pane is often
hidden, which **pauses requestAnimationFrame**, so test pages must draw synchronously on load and expose
functions you call directly (`javascript_tool`), never relying on rAF. To read a result as text, dump
the source canvas to an ASCII string (luminance to the ramp) and return it from `javascript_tool`.
Screenshots also force a paint if you want to look at the visible canvas.
