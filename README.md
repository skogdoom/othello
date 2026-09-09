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
```

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
  ai/      evaluation + search
  render/  PixiJS: board, discs, flip animation, hints, hit-testing
  ui/      DOM HUD
  audio/   WebAudio wrapper
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
specifies rendering, layout, input and audio.

## Status

Built in vertical slices, each one playable in a browser.

| Slice | What it adds | State |
|-------|--------------|-------|
| S1 | Playable skeleton: rules, move list, state machine, depth-2 AI, Pixi board, HUD | Done |
| S2 | Flip cascade, placement animation, audio with synthesized placeholders, mute | Done |
| S3 | Responsive layout, two HUD layouts, safe areas, touch input | Done (not yet run on a physical device) |
| S4 | Real AI: worker, alpha-beta, iterative deepening, three difficulty levels | Not started |
| S5 | Undo and resume | Not started |
| S6 | Real sound assets | Not started |
| S7 | Hardening and release | Not started |

Until S6 lands, `/sounds/` is empty on purpose and every sound is a synthesized
placeholder. Until S4 lands, all three difficulty levels play the same depth-2
search.

## Licence

MIT — see [LICENSE](LICENSE).
