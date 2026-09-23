import type { Ticker } from 'pixi.js';

type Tween = Readonly<{
  duration: number;
  delay: number;
  onUpdate: (t: number) => void;
  onComplete?: (() => void) | undefined;
}> & { elapsed: number };

/** Smooth in and out; the flip reads better than it does linear. */
export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (1 - t) * (1 - t) * 2;

/**
 * The whole animation system: a list of tweens stepped by Pixi's ticker. A
 * library would not earn its bundle size here.
 *
 * `onChange` fires whenever a tween is added, or moves something on screen —
 * never for a tick spent waiting out a delay. The renderer draws on demand,
 * so this is how it knows a frame is needed.
 */
export class Tweens {
  private readonly running: Tween[] = [];

  constructor(
    private readonly ticker: Ticker,
    private readonly onChange: () => void = () => {},
  ) {
    this.ticker.add(this.step);
  }

  private readonly step = (): void => {
    if (this.running.length === 0) return;
    const dt = this.ticker.deltaMS;
    let changed = false;

    // Iterate over a copy: a completion callback may start the next tween.
    for (const tween of [...this.running]) {
      tween.elapsed += dt;
      const t = (tween.elapsed - tween.delay) / tween.duration;
      if (t < 0) continue;
      changed = true;
      if (t >= 1) {
        this.finish(tween);
        continue;
      }
      tween.onUpdate(t);
    }
    if (changed) this.onChange();
  };

  private finish(tween: Tween): void {
    const at = this.running.indexOf(tween);
    if (at === -1) return; // already finished, by snap or by an earlier step
    this.running.splice(at, 1);
    tween.onUpdate(1);
    tween.onComplete?.();
  }

  add(spec: {
    duration: number;
    delay?: number;
    onUpdate: (t: number) => void;
    onComplete?: () => void;
  }): void {
    this.running.push({
      duration: Math.max(1, spec.duration),
      delay: spec.delay ?? 0,
      onUpdate: spec.onUpdate,
      onComplete: spec.onComplete,
      elapsed: 0,
    });
    this.onChange();
  }

  get busy(): boolean {
    return this.running.length > 0;
  }

  /**
   * Jumps every tween to its end state rather than cancelling it: an
   * interrupted flip must not leave a disc frozen at scale.x = 0.
   */
  finishAll(): void {
    if (this.running.length === 0) return;
    let guard = 0;
    while (this.running.length > 0) {
      this.finish(this.running[0]!);
      if (++guard > 1000) throw new Error('Tween completion loop does not settle');
    }
    this.onChange();
  }
}
