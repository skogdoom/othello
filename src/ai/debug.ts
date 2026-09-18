import { applyMove, legalMoves } from '../core/rules.js';
import { opponent } from '../core/types.js';
import { discDiff, hardEval, mediumEval } from './eval.js';
import type { Board } from '../core/board.js';
import type { Player, Square } from '../core/types.js';
import type { Level } from './levels.js';

export type MoveScore = Readonly<{ square: Square; score: number }>;

const EVAL: Readonly<Record<Level, (b: Board, p: Player) => number>> = {
  easy: discDiff,
  medium: mediumEval,
  hard: hardEval,
};

/**
 * Dev-only: every legal move for `p`, ranked by the static evaluation of the
 * position it leads to (from `p`'s point of view, one ply deep — the search
 * itself looks much further, but this is for eyeballing the evaluation
 * function's own opinion of a position, not for reproducing the search).
 * Used by the `aiDebug` URL-flag stepper to help tune `ai/eval.ts`'s weights.
 */
export function rankMoves(b: Board, p: Player, level: Level): MoveScore[] {
  const evalFn = EVAL[level];
  return legalMoves(b, p)
    .map((square) => ({
      square,
      score: -evalFn(applyMove(b, p, square).board, opponent(p)),
    }))
    .sort((a, z) => z.score - a.score);
}
