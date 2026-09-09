export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Player = typeof BLACK | typeof WHITE;
export type Cell = typeof EMPTY | Player;

export const opponent = (p: Player): Player => (3 - p) as Player;

/** 0..63, row-major: index = row * 8 + col */
export type Square = number;

export const PASS = -1;
export type Move = Square | typeof PASS;

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

export const squareOf = (row: number, col: number): Square => row * SIZE + col;
export const rowOf = (s: Square): number => (s / SIZE) | 0;
export const colOf = (s: Square): number => s % SIZE;
