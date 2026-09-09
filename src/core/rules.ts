import { CELLS, EMPTY, SIZE, colOf, opponent, rowOf } from './types.js';
import type { Board } from './board.js';
import type { Player, Square } from './types.js';

export class IllegalMoveError extends Error {
  constructor(readonly square: Square, readonly player: Player) {
    super(`Illegal move: player ${player} at square ${square}`);
    this.name = 'IllegalMoveError';
  }
}

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/** Flat index offset per direction. */
const OFFSET: Int8Array = new Int8Array(
  DIRECTIONS.map(([dr, dc]) => dr * SIZE + dc),
);

/**
 * STEPS[s * 8 + d] is how many times we may step from square s in direction d
 * before leaving the board. Precomputing this keeps the ray scan free of
 * per-step edge arithmetic, which is what wrap-around bugs are made of.
 */
const STEPS: Int8Array = (() => {
  const t = new Int8Array(CELLS * DIRECTIONS.length);
  for (let s = 0; s < CELLS; s++) {
    const row = rowOf(s);
    const col = colOf(s);
    for (let d = 0; d < DIRECTIONS.length; d++) {
      const [dr, dc] = DIRECTIONS[d]!;
      const vertical = dr < 0 ? row : dr > 0 ? SIZE - 1 - row : SIZE;
      const horizontal = dc < 0 ? col : dc > 0 ? SIZE - 1 - col : SIZE;
      t[s * DIRECTIONS.length + d] = Math.min(vertical, horizontal);
    }
  }
  return t;
})();

/**
 * Appends to `out` the squares flipped in direction `d` by playing `p` at `s`,
 * and returns how many were appended (0 when the ray does not capture).
 */
function scan(
  b: Board,
  p: Player,
  s: Square,
  d: number,
  out: Square[],
): number {
  const steps = STEPS[s * DIRECTIONS.length + d]!;
  const off = OFFSET[d]!;
  const foe = opponent(p);
  let cur = s + off;
  let n = 0;
  while (n < steps && b.cells[cur] === foe) {
    n++;
    cur += off;
  }
  if (n === 0 || n === steps || b.cells[cur] !== p) return 0;
  for (let i = 0, sq = s + off; i < n; i++, sq += off) out.push(sq);
  return n;
}

/** Squares flipped by playing `p` at `s`; empty when the move is illegal. */
function flips(b: Board, p: Player, s: Square): Square[] {
  const out: Square[] = [];
  if (b.cells[s] !== EMPTY) return out;
  for (let d = 0; d < DIRECTIONS.length; d++) scan(b, p, s, d, out);
  return out;
}

export function isLegal(b: Board, p: Player, s: Square): boolean {
  if (s < 0 || s >= CELLS || b.cells[s] !== EMPTY) return false;
  const scratch: Square[] = [];
  for (let d = 0; d < DIRECTIONS.length; d++) {
    if (scan(b, p, s, d, scratch) > 0) return true;
  }
  return false;
}

export function legalMoves(b: Board, p: Player): Square[] {
  const out: Square[] = [];
  for (let s = 0; s < CELLS; s++) if (isLegal(b, p, s)) out.push(s);
  return out;
}

export type MoveResult = Readonly<{
  board: Board;
  placed: Square;
  flipped: readonly Square[];
}>;

export function applyMove(b: Board, p: Player, s: Square): MoveResult {
  if (s < 0 || s >= CELLS) throw new IllegalMoveError(s, p);
  const flipped = flips(b, p, s);
  if (flipped.length === 0) throw new IllegalMoveError(s, p);

  const cells = Int8Array.from(b.cells);
  cells[s] = p;
  for (const f of flipped) cells[f] = p;
  return { board: { cells }, placed: s, flipped };
}
