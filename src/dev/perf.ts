import { budgetMs } from '../ai/index.js';
import type { Application } from 'pixi.js';
import type { SearchStats } from '../ai/protocol.js';

/** Frame timings older than this drop out of the rolling figures. */
const WINDOW_MS = 2000;
/** A frame this long is visible as a stutter. */
const LONG_FRAME_MS = 50;
const SEARCHES_SHOWN = 8;

const percentile = (sorted: readonly number[], q: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

function kilo(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

/**
 * Dev-only overlay behind the `?perf` URL flag, for profiling on a real phone
 * where no devtools are attached: frame rate and frame times from the render
 * loop, and for every AI search the depth it reached, whether it solved the
 * game, and how its time compares to the level's budget. Those two numbers
 * are what decide whether the board representation needs to get faster.
 * Never imported unless the flag is present.
 */
export class PerfPanel {
  private readonly root: HTMLElement;
  private readonly frames: { at: number; dt: number }[] = [];
  private readonly searches: SearchStats[] = [];
  private longFrames = 0;
  private last = performance.now();

  constructor(private readonly app: Application) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed',
      'top:calc(8px + env(safe-area-inset-top))',
      'left:calc(8px + env(safe-area-inset-left))',
      'z-index:1000',
      'max-width:calc(100vw - 16px)',
      'padding:6px 8px',
      'background:#0e1013e6',
      'color:#f4f2ec',
      'border:1px solid #3a3f45',
      'border-radius:8px',
      'font:11px/1.35 ui-monospace, monospace',
      'white-space:pre',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(this.root);

    app.ticker.add(this.tick);
    // A backgrounded tab stops the render loop; the gap is not a slow frame.
    document.addEventListener('visibilitychange', () => {
      this.frames.length = 0;
      this.last = performance.now();
    });
    globalThis.setInterval(() => this.render(), 500);
    this.render();
  }

  recordSearch(stats: SearchStats): void {
    this.searches.unshift(stats);
    this.searches.length = Math.min(this.searches.length, SEARCHES_SHOWN);
    this.render();
  }

  private readonly tick = (): void => {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (dt >= LONG_FRAME_MS) this.longFrames++;
    this.frames.push({ at: now, dt });
    while (this.frames.length > 0 && this.frames[0]!.at < now - WINDOW_MS) this.frames.shift();
  };

  private render(): void {
    const dts = this.frames.map((f) => f.dt).sort((a, b) => a - b);
    const span = dts.reduce((sum, dt) => sum + dt, 0);
    const fps = span > 0 ? (dts.length * 1000) / span : 0;

    const renderer = this.app.renderer;
    const canvas = this.app.canvas;
    const lines = [
      `${fps.toFixed(0)} fps  p95 ${percentile(dts, 0.95).toFixed(1)} ms  ` +
        `max ${(dts[dts.length - 1] ?? 0).toFixed(1)} ms  long ${this.longFrames}`,
      `${renderer.name}  dpr ${globalThis.devicePixelRatio}  res ${renderer.resolution}  ` +
        `${canvas.width}x${canvas.height}  cores ${navigator.hardwareConcurrency ?? '?'}`,
    ];

    if (this.searches.length === 0) lines.push('no AI search yet');
    for (const s of this.searches) lines.push(describe(s));

    this.root.textContent = lines.join('\n');
  }
}

function describe(s: SearchStats): string {
  const budget = budgetMs(s.level);
  const time = budget === null ? `${s.ms.toFixed(0)} ms` : `${s.ms.toFixed(0)}/${budget} ms`;
  const over = budget !== null && s.ms > budget * 1.1 ? ' OVER' : '';
  const outcome = s.depth === 0 ? 'forced' : s.complete ? `d${s.depth} solved` : `d${s.depth}`;
  const rate = s.ms > 0 ? `${kilo((s.nodes * 1000) / s.ms)}/s` : '';
  return [
    s.level.padEnd(6),
    `${String(s.empties).padStart(2)}e `,
    outcome.padEnd(10),
    time.padEnd(11),
    kilo(s.nodes).padStart(6),
    rate + over,
  ].join(' ');
}
