import { emptyCount } from '../core/board.js';
import { legalMoves } from '../core/rules.js';
import { CELLS, EMPTY, SIZE, opponent } from '../core/types.js';
import type { Board } from '../core/board.js';
import type { Player } from '../core/types.js';

/** Disc difference from `p`'s point of view. Easy's whole evaluation, and
 * exact once the game reaches a terminal position, which is what makes
 * running the same search with this eval to a deep enough depth an endgame
 * solver rather than a separate algorithm. */
export function discDiff(b: Board, p: Player): number {
  let mine = 0;
  let theirs = 0;
  const foe = opponent(p);
  for (let s = 0; s < CELLS; s++) {
    if (b.cells[s] === p) mine++;
    else if (b.cells[s] === foe) theirs++;
  }
  return mine - theirs;
}

/**
 * Classic static weight table: corners are the most valuable squares on the
 * board and can never be flipped; the squares diagonally adjacent to a
 * corner are the worst, since playing one usually hands the opponent that
 * corner; edges are good; the interior is mild.
 */
// prettier-ignore
const WEIGHTS: readonly number[] = [
  120, -20,  20,   5,   5,  20, -20, 120,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
   20,  -5,  15,   3,   3,  15,  -5,  20,
    5,  -5,   3,   3,   3,   3,  -5,   5,
    5,  -5,   3,   3,   3,   3,  -5,   5,
   20,  -5,  15,   3,   3,  15,  -5,  20,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
  120, -20,  20,   5,   5,  20, -20, 120,
];

function positionScore(b: Board, p: Player): number {
  let score = 0;
  const foe = opponent(p);
  for (let s = 0; s < CELLS; s++) {
    if (b.cells[s] === p) score += WEIGHTS[s]!;
    else if (b.cells[s] === foe) score -= WEIGHTS[s]!;
  }
  return score;
}

/** -100..100. Zero when neither side can move (the position is over). */
function mobilityScore(b: Board, p: Player): number {
  const mine = legalMoves(b, p).length;
  const theirs = legalMoves(b, opponent(p)).length;
  if (mine + theirs === 0) return 0;
  return (100 * (mine - theirs)) / (mine + theirs);
}

function hasEmptyNeighbor(b: Board, s: number): boolean {
  const row = (s / SIZE) | 0;
  const col = s % SIZE;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
      if (b.cells[r * SIZE + c] === EMPTY) return true;
    }
  }
  return false;
}

/**
 * -100..100. A disc touching an empty square is a "frontier" disc: it can be
 * captured along the ray through that gap, so having fewer of them is good.
 */
function frontierScore(b: Board, p: Player): number {
  let mine = 0;
  let theirs = 0;
  const foe = opponent(p);
  for (let s = 0; s < CELLS; s++) {
    const c = b.cells[s];
    if (c !== p && c !== foe) continue;
    if (!hasEmptyNeighbor(b, s)) continue;
    if (c === p) mine++;
    else theirs++;
  }
  if (mine + theirs === 0) return 0;
  return (100 * (theirs - mine)) / (mine + theirs);
}

type Fullness = Readonly<{
  row: readonly boolean[];
  col: readonly boolean[];
  diag: readonly boolean[];
  anti: readonly boolean[];
}>;

/** Per-line "no empty square on this line" flags, computed once per board. */
function lineFullness(b: Board): Fullness {
  const row = new Array<boolean>(SIZE).fill(true);
  const col = new Array<boolean>(SIZE).fill(true);
  const diag = new Array<boolean>(2 * SIZE - 1).fill(true); // index: r - c + SIZE - 1
  const anti = new Array<boolean>(2 * SIZE - 1).fill(true); // index: r + c
  for (let s = 0; s < CELLS; s++) {
    if (b.cells[s] !== EMPTY) continue;
    const r = (s / SIZE) | 0;
    const c = s % SIZE;
    row[r] = false;
    col[c] = false;
    diag[r - c + SIZE - 1] = false;
    anti[r + c] = false;
  }
  return { row, col, diag, anti };
}

/**
 * A disc is counted stable here only when all four lines through it are
 * completely full, so no move anywhere on the board can ever start a flip
 * along any of them. That undercounts real stability (it misses discs
 * anchored to a stable corner on a line that still has gaps) but it never
 * overcounts, which is what an evaluation term needs.
 */
function stabilityScore(b: Board, p: Player): number {
  const full = lineFullness(b);
  let mine = 0;
  let theirs = 0;
  const foe = opponent(p);
  for (let s = 0; s < CELLS; s++) {
    const c = b.cells[s];
    if (c !== p && c !== foe) continue;
    const r = (s / SIZE) | 0;
    const col = s % SIZE;
    const stable = full.row[r] && full.col[col] && full.diag[r - col + SIZE - 1] && full.anti[r + col];
    if (!stable) continue;
    if (c === p) mine++;
    else theirs++;
  }
  return 10 * (mine - theirs);
}

/** Position table plus mobility. Medium's whole evaluation. */
export function mediumEval(b: Board, p: Player): number {
  return positionScore(b, p) + 8 * mobilityScore(b, p);
}

/**
 * Position table, mobility, frontier and stability, phased by how much of
 * the board is filled: mobility and frontier matter most in the opening,
 * when they shape the position for many moves to come; stability and disc
 * count matter most once the endgame is close and captures start sticking.
 */
export function hardEval(b: Board, p: Player): number {
  const t = 1 - emptyCount(b) / CELLS; // 0 at the opening, 1 once the board is full

  const positionWeight = 1 - 0.4 * t;
  const mobilityWeight = 10 - 6 * t;
  const frontierWeight = 4 - 2 * t;
  const stabilityWeight = 1 + 4 * t;
  const discWeight = 6 * t;

  return (
    positionWeight * positionScore(b, p) +
    mobilityWeight * mobilityScore(b, p) +
    frontierWeight * frontierScore(b, p) +
    stabilityWeight * stabilityScore(b, p) +
    discWeight * discDiff(b, p)
  );
}
