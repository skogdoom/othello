import { Application } from 'pixi.js';
import { findMove } from './ai/index.js';
import { BoardRenderer } from './render/board.js';
import { THEME } from './render/theme.js';
import { Hud } from './ui/hud.js';
import { WebAudioPlayer } from './audio/index.js';
import { createMachine } from './machine.js';
import type { Machine } from './machine.js';
import type { ClockPort, SearchPort, StoragePort } from './ports.js';

const stage = document.querySelector<HTMLElement>('#stage')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;

const app = new Application();
await app.init({
  width: THEME.boardSize,
  height: THEME.boardSize,
  background: THEME.feltEdge,
  preference: 'webgl',
  antialias: true,
  resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
  autoDensity: true,
});
stage.appendChild(app.canvas);

const clock: ClockPort = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

/**
 * S1 runs the search on the main thread, one turn of the event loop later so
 * the board repaints first. S4 swaps the body for a Web Worker; the port and
 * the abort semantics stay as they are.
 */
const search: SearchPort = (() => {
  let controller: AbortController | null = null;
  return {
    start(req, onDone) {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      globalThis.setTimeout(() => {
        if (own.signal.aborted) return;
        onDone(findMove(req.board, req.player, req.level, own.signal));
      }, 0);
    },
    abort() {
      controller?.abort();
      controller = null;
    },
  };
})();

/** S1 keeps no state across reloads; S5 swaps in localStorage. */
const storage: StoragePort = {
  save() {},
  load: () => null,
};

const audio = new WebAudioPlayer();
// iOS only starts an audio context inside a user gesture, and the gesture that
// starts the game is the first tap on the board.
globalThis.addEventListener('pointerdown', () => audio.unlock(), { capture: true });

let machine: Machine;
const renderer = new BoardRenderer(app, (square) => machine.tap(square));
const hud = new Hud(hudRoot, {
  onRestart: () => machine.restart(),
  onToggleMute: () => audio.setMuted(!audio.isMuted()),
  isMuted: () => audio.isMuted(),
});
machine = createMachine({ renderer, hud, audio, search, clock, storage });
machine.start();

// Decoding happens after the first frame: a missing clip must not hold up the
// board, and every sound falls back to a placeholder on its own.
void audio.load();
