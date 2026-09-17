import { describe, expect, it } from 'vitest';
import { fitBoard } from '../src/render/layout.js';

describe('board fit', () => {
  it('fills a square stage exactly', () => {
    expect(fitBoard(800, 800, 800)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('letterboxes sideways on a wide stage', () => {
    expect(fitBoard(1200, 800, 800)).toEqual({ scale: 1, x: 200, y: 0 });
  });

  it('letterboxes vertically on a tall stage', () => {
    expect(fitBoard(800, 1200, 800)).toEqual({ scale: 1, x: 0, y: 200 });
  });

  it('scales down to the short side of a phone in portrait', () => {
    const fit = fitBoard(390, 640, 800);
    expect(fit.scale).toBeCloseTo(0.4875, 6);
    expect(fit.x).toBe(0);
    expect(fit.y).toBeCloseTo(125, 6);
  });

  it('scales up on a large display', () => {
    expect(fitBoard(1600, 1600, 800).scale).toBe(2);
  });

  it('survives a stage with no size yet', () => {
    for (const [w, h] of [[0, 0], [-10, 100], [Number.NaN, 500]]) {
      const fit = fitBoard(w!, h!, 800);
      expect(fit.scale).toBe(0);
      expect(Number.isFinite(fit.x) && Number.isFinite(fit.y)).toBe(true);
    }
  });
});
