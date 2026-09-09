import { BLACK, CELLS, EMPTY, WHITE, squareOf } from './types.js';
import type { Cell, Player, Square } from './types.js';

export type Board = Readonly<{ cells: Int8Array }>;

export function initialBoard(): Board {
  const cells = new Int8Array(CELLS);
  cells[squareOf(3, 3)] = WHITE;
  cells[squareOf(3, 4)] = BLACK;
  cells[squareOf(4, 3)] = BLACK;
  cells[squareOf(4, 4)] = WHITE;
  return { cells };
}

export function get(b: Board, s: Square): Cell {
  return b.cells[s] as Cell;
}

export function count(b: Board, p: Player): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (b.cells[i] === p) n++;
  return n;
}

export function emptyCount(b: Board): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (b.cells[i] === EMPTY) n++;
  return n;
}
