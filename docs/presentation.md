# Rendering, layout, input and audio

Needed in S2 (feel), S3 (responsive and mobile) and S6 (sound assets).

## Rendering

Draw at a fixed logical size (800x800) and scale the board container to fit;
all coordinate math stays in board units. Set `resolution` to
`devicePixelRatio` capped at 2 — DPR 3 on phones costs fill rate for no
visible gain.

Attach a `ResizeObserver` to the stage element and size the renderer from the
observed box. Do not compute available space from `window.innerWidth` minus an
assumed HUD height.

Render on demand, not on every tick. The board is static almost all the time,
and Pixi's default loop redraws it 60 times a second anyway, which on a phone
is GPU work and battery for nothing. Draw when the position, the hints or the
size change, on every tick while a tween runs, and once more after a WebGL
context is restored, since it comes back blank. Let the ticker stop once there
is nothing to draw. A resize draws at once, because resizing clears the canvas.

**Flip animation:** squash `scale.x` 1 → 0, swap colour at the zero crossing,
then 0 → 1. Cascade flips with a per-disc delay proportional to distance from
the placed disc. Total budget 250–350 ms including cascade. Keep the timing
constants in one place for tuning.

Show faint dots for the human's legal moves.

Draw a thin ring on the most recently placed disc. Without it the board looks
identical after the AI moves regardless of where it played, which is confusing
on mobile in particular. Clear the ring while it is the human's turn only if
it competes visually with the hints — otherwise leave it up.

Visual style: classic green board, black and white discs, flat colours. No
textures, no third-party art, no external fonts. Keep all colours in one
constants module so a restyle is a single-file change.

## Layout

One DOM tree, two flex directions. HUD at the bottom in portrait, as a right
sidebar in landscape:

```html
<div id="app">
  <div id="stage"></div>
  <aside id="hud">…</aside>
</div>
```

```css
#app { display: flex; flex-direction: column; height: 100dvh; }
#hud { flex: 0 0 auto; display: flex; flex-direction: row; }

@media (min-aspect-ratio: 1/1) {
  #app { flex-direction: row; }
  #hud { flex-direction: column; width: 200px; }
}
```

Use `min-aspect-ratio`, not `orientation: landscape` — a narrow desktop window
should get the portrait layout. Use `100dvh`, not `vh`.

In landscape the board is height-constrained, so the HUD in the sidebar costs
no board size. That is the reason for the split; do not "simplify" it back to
a bottom bar.

Safe areas differ per layout: `env(safe-area-inset-bottom)` on the HUD in
portrait; in landscape also `inset-right` on the HUD and `inset-left` on the
stage (apply both sides and let one be zero, since the notch swaps sides).

The game-over overlay covers the stage only, not the HUD. It is dismissible so
the player can look at the final board, and shows winner, final score and a
Play Again button.

HUD contents: live score for both colours, whose turn it is, restart, undo,
difficulty selector, mute toggle. At the 390 px baseline there is room for
labelled buttons rather than an icon row.

Rotating mid-game must not reset anything. The board derives from the move
list so this is free, but test it: rotate during an AI search and during a
flip animation.

## Input

Pixi `pointertap` on the board container, converted to a cell via `toLocal`.
Page-level `touch-action: manipulation`, `user-select: none`,
`viewport-fit=cover`, `maximum-scale=1`.

Input is enabled only in the `humanTurn` phase; the state machine owns that
gate.

## Audio

WebAudio with decoded buffers, not `<audio>` elements. Decode everything at
load. Resume the `AudioContext` on the first `pointerdown` (iOS requires a
user gesture). MP3 or AAC — Safari does not decode Ogg Vorbis. Ship a mute
toggle and persist it. Note that iOS honours the hardware silent switch for
WebAudio.

Four sounds: `place`, `flip`, `invalid`, `end`.

**The game must run with no sound files present.** At load, attempt to fetch
and decode `/sounds/<name>.mp3` for each sound. On any failure — 404, decode
error, no WebAudio at all — fall back to a short synthesized envelope built
from an oscillator and a gain ramp. Resolve each sound independently: a
missing `end.mp3` must not cost you a present `place.mp3`. Log a single
debug-level line per fallback, never an error. Dropping real files into
`/sounds/` later must require no code change.

Placeholder character: low click for place, soft blip for flip, dull thud for
invalid, two-note rising figure for end.

Playback rules:

- One `place` sound per move.
- One `flip` sound per move, not one per disc — volume and pitch scale with
  the number of discs flipped, so a large capture sounds larger. Fifteen
  overlapping samples is noise.
- `invalid` fires only on a tap on an occupied square. A tap on empty board
  area outside the legal squares is silent, since legal moves are already
  shown as hints and a buzz on every mis-tap gets annoying.
