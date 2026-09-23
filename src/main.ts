import { Application } from 'pixi.js';
import { BoardRenderer } from './render/board.js';
import { THEME } from './render/theme.js';
import { Hud } from './ui/hud.js';
import { GameOverOverlay } from './ui/overlay.js';
import { WebAudioPlayer } from './audio/index.js';
import { createMachine } from './machine.js';
import { createSearchClient } from './search-client.js';
import type { Machine } from './machine.js';
import type { SearchStats } from './ai/protocol.js';
import type { ClockPort, HudPort, StoragePort } from './ports.js';

const stage = document.querySelector<HTMLElement>('#stage')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const overlayRoot = document.querySelector<HTMLElement>('#overlay')!;
const loading = document.querySelector<HTMLElement>('#loading');
const params = new URLSearchParams(location.search);

const app = new Application();
try {
  // Pixi falls back from WebGL to WebGPU to a 2D canvas on its own, so this
  // only throws when a browser can draw nothing at all.
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
} catch (error) {
  // Say why, rather than leave "Loading…" up forever.
  if (loading) {
    loading.textContent = 'This browser could not draw the board. Try another browser.';
    loading.classList.add('failed');
  }
  throw error;
}
stage.insertBefore(app.canvas, overlayRoot);

// `window`, not `globalThis`: the test tooling brings Node's typings into this
// program, and Node's `setTimeout` returns an object rather than a number.
const clock: ClockPort = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

/** Set behind the `perf` URL flag; see `dev/perf.ts`. */
let perfPanel: { recordSearch: (stats: SearchStats) => void } | null = null;

const search = createSearchClient(
  // Vite recognises this exact `new Worker(new URL(...))` shape and bundles
  // the worker as its own chunk.
  () => new Worker(new URL('./ai/worker.ts', import.meta.url), { type: 'module' }),
  () => import('./ai/index.js').then((ai) => ai.searchMove),
  (stats) => perfPanel?.recordSearch(stats),
);

const SAVE_KEY = 'othello.game';

/**
 * A private-mode `localStorage` can throw on read or write rather than just
 * being absent, so every call is guarded the same way the audio module
 * guards its own mute flag: a storage failure is never worth a broken game,
 * it just means this session does not resume next time.
 */
const storage: StoragePort = {
  save(json) {
    try {
      globalThis.localStorage?.setItem(SAVE_KEY, json);
    } catch {
      // Ignored — see above.
    }
  },
  load() {
    try {
      return globalThis.localStorage?.getItem(SAVE_KEY) ?? null;
    } catch {
      return null;
    }
  },
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
  onUndo: () => machine.undo(),
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
loading?.remove();

if (params.has('aiDebug')) {
  const { DevStepper } = await import('./dev/stepper.js');
  devStepper = new DevStepper(() => machine.getGame());
}
if (params.has('perf')) {
  const { PerfPanel } = await import('./dev/perf.js');
  perfPanel = new PerfPanel(app);
}

// Decoding happens after the first frame: a missing clip must not hold up the
// board, and every sound falls back to a placeholder on its own.
void audio.load();
