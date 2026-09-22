import { emptyCount } from '../core/board.js';
import { applyMove, legalMoves } from '../core/rules.js';
import { opponent } from '../core/types.js';
import { discDiff, hardEval, mediumEval } from './eval.js';
import { iterativeDeepen } from './search.js';
import type { Board } from '../core/board.js';
import type { Player, Square } from '../core/types.js';
import type { EvalFn, SearchResult } from './search.js';
import type { Level } from './levels.js';

export type { Level } from './levels.js';
export type { SearchResult } from './search.js';
export { LEVELS, isLevel } from './levels.js';

export class NoMoveError extends Error {
  constructor() {
    super('findMove called for a player with no legal move');
    this.name = 'NoMoveError';
  }
}

/**
 * Wall-clock budget for medium and hard, per the AI table in CLAUDE.md.
 * Mutable only so the test suite can shrink it — a 100-game match test at the
 * real budget would take minutes. Application code must never write to this.
 */
const BUDGET_MS: Record<'medium' | 'hard', number> = { medium: 250, hard: 800 };

/** The wall-clock budget a level searches against, or `null` for easy's fixed depth. */
export function budgetMs(level: Level): number | null {
  return level === 'easy' ? null : BUDGET_MS[level];
}

/** Test-only: shrinks the search budget so the AI match tests run in seconds. */
export function __setBudgetForTests(level: 'medium' | 'hard', ms: number): void {
  BUDGET_MS[level] = ms;
}

/**
 * Test-only: caps how deep medium and hard search, in place of the
 * empties-derived depth `findMove` otherwise uses. A wall-clock budget makes
 * a fixed-time match test flaky by nature — how deep the search gets before
 * the deadline depends on the machine running it, not just the algorithm.
 * Capping the depth and leaving the budget generous (so the deadline is
 * never actually reached) makes the search's outcome depend only on the
 * position, so a match test is reproducible everywhere it runs.
 */
const MAX_DEPTH_CAP: Record<'medium' | 'hard', number | null> = { medium: null, hard: null };

export function __setMaxDepthForTests(level: 'medium' | 'hard', depth: number | null): void {
  MAX_DEPTH_CAP[level] = depth;
}

/** Exact-solve once this many squares or fewer are empty, per the AI table. */
const SOLVE_THRESHOLD: Readonly<Record<'medium' | 'hard', number>> = { medium: 8, hard: 12 };

const EVAL: Readonly<Record<'medium' | 'hard', EvalFn>> = { medium: mediumEval, hard: hardEval };

/** Plain negamax, no pruning, no transposition table — depth 2 does not need either. */
function negamax(b: Board, p: Player, depth: number, count: { nodes: number }): number {
  count.nodes++;
  const moves = legalMoves(b, p);
  if (moves.length === 0) {
    if (legalMoves(b, opponent(p)).length === 0) return discDiff(b, p);
    if (depth <= 0) return discDiff(b, p);
    return -negamax(b, opponent(p), depth - 1, count);
  }
  if (depth <= 0) return discDiff(b, p);

  let best = -Infinity;
  for (const m of moves) {
    best = Math.max(best, -negamax(applyMove(b, p, m).board, opponent(p), depth - 1, count));
  }
  return best;
}

/** Depth 2, no deepening, disc count only — genuinely bad Othello by design. */
function easyMove(b: Board, p: Player): SearchResult {
  const moves = legalMoves(b, p);
  const count = { nodes: 0 };
  let bestMove = moves[0]!;
  let bestScore = -Infinity;
  for (const m of moves) {
    const score = -negamax(applyMove(b, p, m).board, opponent(p), 1, count);
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }
  return { move: bestMove, depth: 2, complete: false, nodes: count.nodes };
}

export function findMove(b: Board, p: Player, level: Level, signal?: AbortSignal): Square {
  return searchMove(b, p, level, signal).move;
}

/**
 * `findMove` plus how the search went — depth reached, whether it solved the
 * rest of the game, nodes visited. The worker reports these for the `?perf`
 * overlay, which is how the time budgets get checked on a real phone.
 */
export function searchMove(
  b: Board,
  p: Player,
  level: Level,
  signal?: AbortSignal,
): SearchResult {
  const moves = legalMoves(b, p);
  if (moves.length === 0) throw new NoMoveError();
  if (moves.length === 1) return { move: moves[0]!, depth: 0, complete: false, nodes: 0 };

  if (level === 'easy') return easyMove(b, p);

  const budget = BUDGET_MS[level];
  const empties = emptyCount(b);
  const cap = MAX_DEPTH_CAP[level];

  // Solving exactly is the same search with an exact-at-terminal eval and a
  // depth generous enough to always reach the end of the game.
  if (empties <= SOLVE_THRESHOLD[level]) {
    return iterativeDeepen(b, p, discDiff, budget, signal, cap ?? empties * 2 + 4);
  }
  return iterativeDeepen(b, p, EVAL[level], budget, signal, cap ?? empties + 4);
}
