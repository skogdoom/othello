import { count } from '../core/board.js';
import { applyMove, legalMoves } from '../core/rules.js';
import { opponent } from '../core/types.js';
import type { Board } from '../core/board.js';
import type { Player, Square } from '../core/types.js';
import type { Level } from './levels.js';

export type { Level } from './levels.js';
export { LEVELS, isLevel } from './levels.js';

export class NoMoveError extends Error {
  constructor() {
    super('findMove called for a player with no legal move');
    this.name = 'NoMoveError';
  }
}

/**
 * S1: every level is the same depth-2, disc-count search. S4 replaces the
 * body with alpha-beta + iterative deepening + a real evaluation and moves it
 * into a worker; this signature is the boundary that makes that a shim.
 */
const DEPTH: Readonly<Record<Level, number>> = {
  easy: 2,
  medium: 2,
  hard: 2,
};

/** Disc difference from `p`'s point of view — genuinely bad Othello. */
function evaluate(b: Board, p: Player): number {
  return count(b, p) - count(b, opponent(p));
}

/** Negamax, no pruning. `p` is the side to move at this node. */
function negamax(b: Board, p: Player, depth: number): number {
  const moves = legalMoves(b, p);

  if (moves.length === 0) {
    if (legalMoves(b, opponent(p)).length === 0) return evaluate(b, p);
    if (depth <= 0) return evaluate(b, p);
    return -negamax(b, opponent(p), depth - 1);
  }
  if (depth <= 0) return evaluate(b, p);

  let best = -Infinity;
  for (const m of moves) {
    const score = -negamax(applyMove(b, p, m).board, opponent(p), depth - 1);
    if (score > best) best = score;
  }
  return best;
}

export function findMove(
  b: Board,
  p: Player,
  level: Level,
  signal?: AbortSignal,
): Square {
  const moves = legalMoves(b, p);
  if (moves.length === 0) throw new NoMoveError();

  let bestMove = moves[0]!;
  let bestScore = -Infinity;

  for (const m of moves) {
    if (signal?.aborted) break;
    const score = -negamax(applyMove(b, p, m).board, opponent(p), DEPTH[level] - 1);
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }
  return bestMove;
}
