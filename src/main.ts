import { Application } from 'pixi.js';
import { BoardRenderer } from './render/board.js';
import { THEME } from './render/theme.js';
import { Hud } from './ui/hud.js';
import { GameOverOverlay } from './ui/overlay.js';
import { WebAudioPlayer } from './audio/index.js';
import { createMachine } from './machine.js';
import type { Machine } from './machine.js';
import type { Square } from './core/types.js';
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
 * Runs `findMove` in a Web Worker so a slow search never stalls the flip
 * animation. `abort()` cannot truly preempt a search already running on the
 * worker's single thread, so it just supersedes the request id: a reply that
 * arrives for a stale id is dropped here, and the machine's own epoch guard
 * drops it again for good measure.
 */
const search: SearchPort = (() => {
  const worker = new Worker(new URL('./ai/worker.ts', import.meta.url), { type: 'module' });
  let requestId = 0;
  let onDone: ((move: Square) => void) | null = null;

  worker.onmessage = (event: MessageEvent<{ requestId: number; move: Square }>) => {
    if (event.data.requestId !== requestId) return; // superseded by a newer request
    const cb = onDone;
    onDone = null;
    cb?.(event.data.move);
  };

  return {
    start(req, cb) {
      requestId++;
      onDone = cb;
      worker.postMessage({
        requestId,
        cells: req.board.cells,
        player: req.player,
        level: req.level,
      });
    },
    abort() {
      requestId++;
      onDone = null;
      worker.postMessage({ abort: true });
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
  onSetDifficulty: (level) => machine.setDifficulty(level),
  // Hud reads this once at construction, before `machine` exists — hence the
  // optional chaining, even though every later call happens after start().
  getDifficulty: () => machine?.getGame().difficulty ?? 'easy',
});
const overlay = new GameOverOverlay(overlayRoot, () => machine.restart());

/**
 * Set behind the `aiDebug` URL flag. Deliberately left `null` here: the
 * dynamic import below is the only `await` between here and `machine.start()`
 * — resolving it now, before `machine` exists, would leave a window where a
 * DOM event (a real one is astronomically unlikely, but Playwright can fire
 * one synthetically) reaches `ui.render` and calls into an unassigned
 * `machine`. It is created once `machine` is guaranteed to exist instead.
 */
let devStepper: { refresh: () => void } | null = null;

/** The HUD and the game-over panel are both driven by the same phase entry. */
const ui: HudPort = {
  render(pos, phase, canUndo) {
    hud.render(pos, phase, canUndo);
    overlay.render(pos, phase, canUndo);
    devStepper?.refresh();
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

if (new URLSearchParams(location.search).has('aiDebug')) {
  const { DevStepper } = await import('./dev/stepper.js');
  devStepper = new DevStepper(() => machine.getGame());
}

// Decoding happens after the first frame: a missing clip must not hold up the
// board, and every sound falls back to a placeholder on its own.
void audio.load();
