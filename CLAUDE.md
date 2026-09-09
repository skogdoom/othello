# Othello (Reversi) — web game

Browser-based Othello played against the computer. No server: the finished
product is static files that run from any static host.

## Reference docs

Read these when the work touches them. Do not re-derive what they specify.

- `docs/api.md` — the core module API and the game state machine. **Settled.**
  Implement as written; if something turns out to be wrong in practice, say so
  and explain why before deviating. Needed in S1, S4 and S5.
- `docs/presentation.md` — rendering, layout, input and audio. Needed in S2,
  S3 and S6.

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

1. **The game is a move list, not a mutable board.** The board is derived by
   replaying moves from the start position. Undo, save/resume and a possible
   future replay feature all fall out of this. Starting with a mutable board
   means rewriting the core later. Exact shape in `docs/api.md`.

2. **An explicit state machine** from the first commit. Build it in S1 even
   though `humanMoveResolving` completes instantly with no animation in it.
   Retrofitting an async phase into code that assumes moves apply
   synchronously is where this kind of project goes wrong. Full spec in
   `docs/api.md`.

3. **A clean AI boundary**: `findMove(board, player, level, signal)`, with no
   DOM or Pixi imports, so moving it into a worker in S4 is a message-passing
   shim rather than a rewrite.

### Board representation

Start with `Int8Array(64)` behind an opaque `Board` type. Only consider
bitboards if profiling on a real phone shows the search missing its time
budget.

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

| Level  | Search                | Evaluation                                               | Endgame solve |
|--------|-----------------------|----------------------------------------------------------|---------------|
| Easy   | Depth 2, no deepening | Disc count only (which is genuinely bad Othello)          | Off           |
| Medium | ~250 ms budget        | Position table + mobility                                 | Last 8        |
| Hard   | ~800 ms budget        | Position table + mobility + frontier + stability, phased  | Last 12       |

The search runs in a Web Worker so it never stalls animation. Level is passed
with each request, so switching mid-game is allowed. A ~400 ms minimum delay
before the AI's move lands is enforced by the state machine even when the
search returns instantly, otherwise the pacing feels wrong.

## Persistence

Autosave the move list plus difficulty and mute to `localStorage` on every
phase entry — not on `beforeunload`, which is unreliable on iOS. Include a
`version` field; `deserialize` returns `null` on anything it can't parse and
the caller starts a new game. Undo depth is unlimited, back to the opening.

## Build order — vertical slices

Each slice ends with something playable in a browser. Do not start the next
slice until the current one runs.

- **S1 — Playable skeleton.** Desktop Chrome only, fixed 800x800, no
  animation, no sound, depth-2 AI on the main thread, no persistence. Ugly but
  complete: a full game can be played and won. Includes the three structural
  requirements above.
- **S2 — Feel.** Flip cascade, placement animation, last-move ring, animation
  queue wired into the resolving phases, the 400 ms AI delay. Audio system
  with synthesized placeholders, mute toggle, iOS unlock.
- **S3 — Responsive and mobile.** Logical-size scaling, `ResizeObserver`, the
  two HUD layouts, safe areas, touch input, DPR cap.
- **S4 — Real AI.** Worker, alpha-beta, deepening, transposition table, full
  evaluation, endgame solver, three levels with the HUD selector. Add a
  URL-flag dev stepper for tuning the evaluation function.
- **S5 — Undo and resume.**
- **S6 — Sound assets.** Source or receive the four real clips, drop them into
  `/sounds/`, level and trim them, verify on device. No code change expected;
  if one is needed, the S2 fallback design was wrong. This slice can be cut or
  deferred without affecting anything else.
- **S7 — Hardening and release.** Cross-browser matrix, on-device profiling,
  loading state, deploy.

Out of scope for v1: replay/scrub UI, move history panel, opening book, hint
or analysis mode, accessibility beyond adequate contrast and tap targets.
Keep the move-list model intact so replay stays cheap to add later.

## Testing

Core tests are non-negotiable. Every case asserts directly on
`currentPosition`:

- Opening: `legal.length === 4` for black on `newGame`.
- Forced pass: a scripted sequence puts a `PASS` in `moves` and gives the same
  colour two consecutive turns in the derived positions.
- Double pass: `status.kind === 'over'` with `emptyCount > 0`.
- Random playout: loop `play(g, randomOf(legal))` to termination, asserting
  `score.black + score.white + emptyCount === 64` at every ply.
- Undo across a pass: `undo(play(...))` restores a position deep-equal to the
  earlier one.
- Round trip: `deserialize(serialize(g))` matches `g`; `deserialize` of
  garbage, of an empty string and of an old `version` all return `null`.

State machine test cases are listed in `docs/api.md`.

The AI must beat a random-move opponent 100 out of 100.

Audio needs one test that the game boots, plays a full move, and ends cleanly
with every sound file absent.

Emulators are fine for layout but not for audio, touch or performance — S3 and
S7 need a real iPhone and a real Android device.

## Start here

Begin with S1, reading `docs/api.md` first.
