# Othello (Reversi) — web game build spec

Build a browser-based Othello game, played against the computer. No server: the
finished product is static files that run from any static host.

## Stack

- TypeScript, strict mode
- PixiJS v8 for the board rendering (WebGL preference, not WebGPU)
- Vite for build and dev server
- Vitest for unit tests
- No UI framework. The HUD is plain TypeScript, HTML and CSS.
- No animation library. Write a small tween helper on Pixi's ticker.

## Target platforms

Latest two versions of Chrome, Safari, Edge and Firefox. iPhone 12 or
equivalent is the baseline mobile device — no support needed below 390 CSS px
width. ES2022 target, no polyfills, no legacy fallbacks.

## Architecture

Hard rule: the game rules and the AI never import PixiJS or touch the DOM.

```
src/
  core/    pure TS: board, move generation, flipping, pass/end detection
  ai/      evaluation + minimax; runs in a Web Worker
  render/  PixiJS: board, discs, flip animation, hints, hit-testing
  ui/      DOM: score, restart, undo, difficulty, game-over overlay, mute
  audio/   WebAudio wrapper (unlock, preload, play)
  main.ts  wiring and the game state machine
```

### Three structural requirements — do not shortcut these

1. **The game is a move list, not a mutable board.**

   ```ts
   type Game = {
     moves: Move[];      // ordered, includes explicit PASS entries
     cursor: number;     // how many moves are applied
     difficulty: Level;
     humanColor: Color;
   }
   ```

   The board is derived by replaying moves from the start position. Undo,
   save/resume and a possible future replay feature all fall out of this.
   Starting with a mutable board means rewriting the core later.

2. **An explicit state machine** from the first commit:
   `PLAYER_TURN | AI_THINKING | ANIMATING | GAME_OVER`. Input is ignored
   outside `PLAYER_TURN`. Build this even in slice 1 where `ANIMATING`
   completes instantly with no animation in it.

3. **A clean AI boundary**: `findMove(board, color, level): Move`, with no DOM
   or Pixi imports, so moving it into a worker later is a message-passing shim
   rather than a rewrite.

### Board representation

Start with `Int8Array(64)` behind a `Board` interface. Only consider bitboards
if profiling on a real phone shows the search missing its time budget.

## Rules correctness

Standard 8x8 Othello, four discs in the centre to start, black moves first,
human plays black. Two rules that are commonly implemented wrong and need
their own tests:

- A player with no legal move passes; the turn silently goes back.
- If neither player has a legal move, the game ends — possibly with empty
  squares still on the board.

## AI

Minimax with alpha-beta pruning (identical results, just faster), iterative
deepening against a wall-clock budget, transposition table keyed by board
hash, move ordering by the previous iteration's best move plus corners first.
When 12 or fewer squares are empty, solve exactly for final disc difference
instead of using the heuristic.

Three difficulty levels, differentiated by search depth and evaluation
quality. Do not weaken the AI with random blunders — that reads as broken
rather than weak.

| Level  | Search                    | Evaluation                                              | Endgame solve |
|--------|---------------------------|---------------------------------------------------------|---------------|
| Easy   | Depth 2, no deepening     | Disc count only (which is genuinely bad Othello)         | Off           |
| Medium | ~250 ms budget            | Position table + mobility                                | Last 8        |
| Hard   | ~800 ms budget            | Position table + mobility + frontier + stability, phased | Last 12       |

The search runs in a Web Worker so it never stalls animation. Level is passed
with each request, so switching mid-game is allowed. Enforce a ~400 ms minimum
delay before the AI's move lands even when the search returns instantly,
otherwise the pacing feels wrong.

## Rendering

Draw at a fixed logical size (800x800) and scale the board container to fit;
all coordinate math stays in board units. Set `resolution` to
`devicePixelRatio` capped at 2 — DPR 3 on phones costs fill rate for no
visible gain.

Attach a `ResizeObserver` to the stage element and size the renderer from the
observed box. Do not compute available space from `window.innerWidth` minus an
assumed HUD height.

**Flip animation:** squash `scale.x` 1 → 0, swap colour at the zero crossing,
then 0 → 1. Cascade flips with a per-disc delay proportional to distance from
the placed disc. Total budget 250–350 ms including cascade. Keep the timing
constants in one place for tuning.

Show faint dots for the human's legal moves.

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

Safe areas differ per layout: `env(safe-area-inset-bottom)` on the HUD in
portrait; in landscape also `inset-right` on the HUD and `inset-left` on the
stage (apply both sides and let one be zero, since the notch swaps sides).

The game-over overlay covers the stage only, not the HUD.

HUD contents: live score for both colours, whose turn it is, restart, undo,
difficulty selector, mute toggle.

## Input

Pixi `pointertap` on the board container, converted to a cell via `toLocal`.
Page-level `touch-action: manipulation`, `user-select: none`,
`viewport-fit=cover`, `maximum-scale=1`.

## Audio

WebAudio with decoded buffers, not `<audio>` elements. Decode everything at
load. Resume the `AudioContext` on the first `pointerdown` (iOS requires a
user gesture). MP3 or AAC — Safari does not decode Ogg Vorbis. Ship a mute
toggle and persist it. Note that iOS honours the hardware silent switch for
WebAudio.

Sounds: place, flip, invalid move, game end.

## Persistence

Autosave the move list plus difficulty and mute to `localStorage` after every
applied move — not on `beforeunload`, which is unreliable on iOS. Include a
`version` field and fall back to a new game if the stored shape doesn't parse.

Undo rolls back to the last position where the human had a legal move (pop
until it's the human's turn and `cursor > 0`) — not a fixed two plies, since
passes intervene. Disable undo during `ANIMATING` and `AI_THINKING`.

## Build order — vertical slices

Each slice ends with something playable in a browser. Do not start the next
slice until the current one runs.

- **S1 — Playable skeleton.** Desktop Chrome only, fixed 800x800, no
  animation, no sound, depth-2 AI on the main thread, no persistence. Ugly but
  complete: a full game can be played and won. Includes the three structural
  requirements above.
- **S2 — Feel.** Flip cascade, placement animation, sound effects, mute,
  animation queue wired into `ANIMATING`, the 400 ms AI delay.
- **S3 — Responsive and mobile.** Logical-size scaling, `ResizeObserver`, the
  two HUD layouts, safe areas, touch input, iOS audio unlock, DPR cap.
- **S4 — Real AI.** Worker, alpha-beta, deepening, transposition table, full
  evaluation, endgame solver, three levels with the HUD selector. Add a
  URL-flag dev stepper for tuning the evaluation function.
- **S5 — Undo and resume.**
- **S6 — Hardening and release.** Cross-browser matrix, on-device profiling,
  loading state, deploy.

Out of scope for v1: replay/scrub UI, move history panel, opening book, hint
or analysis mode, accessibility beyond adequate contrast and tap targets.
Keep the move-list model intact so replay stays cheap to add later.

## Testing

Unit tests for the core are non-negotiable and must cover: the standard
opening, a forced pass, a double-pass ending, a game ending with empty squares
remaining, and a full random playout that never reaches an illegal state.

The AI must beat a random-move opponent 100 out of 100.

Emulators are fine for layout but not for audio, touch or performance — S3 and
S6 need a real iPhone and a real Android device.

## Start here

Begin with S1. Before writing code, propose the `core/` module's public API
and the state machine's transitions, and wait for approval on those two before
implementing the rest.
