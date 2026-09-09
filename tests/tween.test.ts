import { describe, expect, it } from 'vitest';
import { Tweens, easeInOutQuad } from '../src/render/tween.js';
import { TIMING, moveDuration } from '../src/render/timing.js';
import type { Ticker } from 'pixi.js';

/** Stands in for Pixi's ticker: one callback, a settable frame delta. */
class FakeTicker {
  deltaMS = 16;
  private callback: (() => void) | null = null;
  add(fn: () => void): this {
    this.callback = fn;
    return this;
  }
  frame(ms: number): void {
    this.deltaMS = ms;
    this.callback?.();
  }
}

const setup = () => {
  const ticker = new FakeTicker();
  return { ticker, tweens: new Tweens(ticker as unknown as Ticker) };
};

describe('tweens', () => {
  it('runs from 0 to 1 and completes exactly once', () => {
    const { ticker, tweens } = setup();
    const seen: number[] = [];
    let completions = 0;
    tweens.add({
      duration: 100,
      onUpdate: (t) => seen.push(t),
      onComplete: () => completions++,
    });

    for (let i = 0; i < 10; i++) ticker.frame(20);

    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.every((t, i) => i === 0 || t >= seen[i - 1]!)).toBe(true);
    expect(completions).toBe(1);
    expect(tweens.busy).toBe(false);
  });

  it('holds at the start until its delay has passed', () => {
    const { ticker, tweens } = setup();
    const seen: number[] = [];
    tweens.add({ duration: 100, delay: 50, onUpdate: (t) => seen.push(t) });

    ticker.frame(40);
    expect(seen).toEqual([]);
    ticker.frame(20);
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeCloseTo(0.1, 5);
  });

  it('snaps to the end state instead of freezing mid-flip', () => {
    const { ticker, tweens } = setup();
    let scale = 1;
    let completions = 0;
    tweens.add({
      duration: 160,
      onUpdate: (t) => (scale = Math.abs(1 - 2 * t)),
      onComplete: () => completions++,
    });

    ticker.frame(80);
    expect(scale).toBeCloseTo(0, 5); // squashed flat, mid-flip

    tweens.finishAll();
    expect(scale).toBe(1);
    expect(completions).toBe(1);
    expect(tweens.busy).toBe(false);
  });

  it('lets a completion start the next tween', () => {
    const { ticker, tweens } = setup();
    let second = 0;
    tweens.add({
      duration: 50,
      onUpdate: () => {},
      onComplete: () => tweens.add({ duration: 50, onUpdate: (t) => (second = t) }),
    });

    ticker.frame(60);
    expect(second).toBe(0);
    ticker.frame(60);
    expect(second).toBe(1);
  });

  it('eases symmetrically about the halfway point', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 5);
    expect(easeInOutQuad(1)).toBe(1);
  });
});

describe('move timing', () => {
  it('keeps the longest cascade inside the 250-350 ms budget', () => {
    // The longest possible cascade is six squares: place a1, flip b1..g1.
    expect(moveDuration(6)).toBeGreaterThanOrEqual(250);
    expect(moveDuration(6)).toBeLessThanOrEqual(350);
  });

  it('never finishes before the placed disc has landed', () => {
    expect(moveDuration(0)).toBe(TIMING.PLACE_MS);
    expect(moveDuration(1)).toBeGreaterThan(TIMING.PLACE_MS);
  });
});
