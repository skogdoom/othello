# Othello

Browser-based Othello (Reversi) against the computer. No server: the finished
product is static files that run from any static host.

## Disclaimer

**This game relies heavily on vibe coding. Use it at your own risk.**

Most of this codebase was written by an AI assistant from a prose spec rather
than typed out line by line by a human. It has tests and it has been played in
a browser, but it has not been audited, hardened, or reviewed the way you would
review code you were about to depend on. It is a game of Othello, not a
load-bearing system — treat it accordingly. No warranty, express or implied;
see [LICENSE](LICENSE).

## Running it

Requires Node 22.12 or newer (see `engines` in `package.json`).

```sh
npm install
npm run dev      # Vite dev server with HMR
npm test         # Vitest, once
npm run build    # typecheck, then a production build into dist/
npm run e2e      # Playwright smoke tests against the production build
```

`npm run e2e` needs Playwright's browsers once: `npx playwright install`. To
use a Chromium that is already installed elsewhere, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path and run only the Chromium
projects: `npx playwright test --project=chromium --project=mobile-chrome`.

Two URL flags work in any build, including the deployed one:

- `?perf` shows frame times and, for each AI search, the depth reached and
  time spent against the budget. It's for profiling on a phone. See
  `docs/release.md`.
- `?aiDebug` steps through the game and ranks every legal move by the
  current level's evaluation. It's for tuning `ai/eval.ts`.

There is a second dev server on esbuild, useful for checking the app against a
plain bundle and for testing on a real device over the network:

```sh
npm run serve                  # http://127.0.0.1:5174, rebuild + live reload
npm run serve -- --port 8080
npm run serve -- --host        # listen on the LAN
npm run bundle                 # one-shot minified bundle into .esbuild/
```

## How it is put together

The game rules and the AI never import PixiJS or touch the DOM.

```
src/
  core/    pure TS: board, move generation, flipping, pass/end detection
  ai/      evaluation + search, run in a Web Worker
  render/  PixiJS: board, discs, flip animation, hints, hit-testing
  ui/      DOM HUD
  audio/   WebAudio wrapper
  dev/     dev-only tools behind URL flags: the aiDebug stepper, the perf overlay
  search-client.ts  the worker-backed SearchPort, with a main-thread fallback
  ports.ts the interfaces between them
  main.ts  wiring
  machine.ts the game state machine
```

Three things hold the design together:

- **The game is a move list, not a mutable board.** Every position is derived
  by replaying moves from the start, so undo, resume and a future replay
  feature all fall out of the same model.
- **An explicit state machine** owns what the screen may do and when a move
  lands, including the barrier that lets the AI search overlap the flip
  animation.
- **A clean AI boundary** — `findMove(board, player, level, signal)` — so the
  search can move into a Web Worker without a rewrite.

`docs/api.md` specifies the core API and the state machine; `docs/presentation.md`
specifies rendering, layout, input and audio; `docs/release.md` covers the
browser and device matrix, profiling and deploy.

## Status

Built in vertical slices, each one playable in a browser.

| Slice | What it adds | State |
|-------|--------------|-------|
| S1 | Playable skeleton: rules, move list, state machine, depth-2 AI, Pixi board, HUD | Done |
| S2 | Flip cascade, placement animation, audio with synthesized placeholders, mute | Done |
| S3 | Responsive layout, two HUD layouts, safe areas, touch input | Done (verified on iPhone 13 mini; Android still outstanding) |
| S4 | Real AI: worker, alpha-beta, iterative deepening, transposition table, endgame solver, three difficulty levels with the HUD selector, `aiDebug` dev stepper | Done |
| S5 | Undo, and resume from `localStorage` on reload | Done |
| S6 | Real sound assets | Not started |
| S7 | Hardening and release: loading state, renderer and worker fallbacks, CI browser matrix, `?perf` profiling overlay, GitHub Pages deploy | In progress (the real-device checks in `docs/release.md` are outstanding) |

Until S6 lands, `/sounds/` is empty on purpose and every sound is a synthesized
placeholder.

## Licence

MIT — see [LICENSE](LICENSE).
