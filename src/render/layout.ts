import { THEME } from './theme.js';

export type BoardFit = Readonly<{
  /** Board units to CSS pixels. */
  scale: number;
  /** Top-left of the scaled board inside the stage, in CSS pixels. */
  x: number;
  y: number;
}>;

/**
 * Fits the fixed logical board into whatever box the stage element has, so
 * every coordinate above this stays in board units. The board is square, so
 * the short side decides the scale and the long side gets the letterboxing.
 */
export function fitBoard(
  width: number,
  height: number,
  logical: number = THEME.boardSize,
): BoardFit {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  const scale = Math.min(w, h) / logical;
  return { scale, x: (w - logical * scale) / 2, y: (h - logical * scale) / 2 };
}
