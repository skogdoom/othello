import { Application } from 'pixi.js';
import { findMove } from './ai/index.js';
import { BoardRenderer } from './render/board.js';
import { THEME } from './render/theme.js';
import { Hud } from './ui/hud.js';
import { GameOverOverlay } from './ui/overlay.js';
import { WebAudioPlayer } from './audio/index.js';
import { createMachine } from './machine.js';
import type { Machine } from './machine.js';
import type { ClockPort, HudPort, SearchPort, StoragePort } from './ports.js';

const stage = document.querySelector<HTMLElement>('#stage')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const overlayRoot = document.querySelector<HTMLElement>('#overlay')!;

const app = new Application();
await app.init({
  width: stage.clientWidth || THEME.boardSize,
  height: stage.clientHeight || THEME.boardSize,
  background: THEME.page,
  preference: 'webgl',
  antialias: true,
  // DPR 3 on a phone costs fill rate for no visible gain.
  resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
  autoDensity: true,
});
stage.insertBefore(app.canvas, overlayRoot);

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

/** No state across reloads until S5. */
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
const overlay = new GameOverOverlay(overlayRoot, () => machine.restart());

/** The HUD and the game-over panel are both driven by the same phase entry. */
const ui: HudPort = {
  render(pos, phase, canUndo) {
    hud.render(pos, phase, canUndo);
    overlay.render(pos, phase, canUndo);
  },
};

/**
 * Size from the box the stage element actually has, never from
 * `window.innerWidth` minus an assumed HUD height. A rotation, a HUD that
 * wraps onto a second line and a desktop window drag all arrive here the same
 * way — and none of them touch game state, which lives in the move list.
 */
const observer = new ResizeObserver((entries) => {
  const box = entries[entries.length - 1]?.contentRect;
  if (box) renderer.resize(box.width, box.height);
});
observer.observe(stage);
renderer.resize(stage.clientWidth, stage.clientHeight);

machine = createMachine({ renderer, hud: ui, audio, search, clock, storage });
machine.start();

// Decoding happens after the first frame: a missing clip must not hold up the
// board, and every sound falls back to a placeholder on its own.
void audio.load();
