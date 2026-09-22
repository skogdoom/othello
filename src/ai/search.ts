import { applyMove, legalMoves } from '../core/rules.js';
import { opponent } from '../core/types.js';
import type { Board } from '../core/board.js';
import type { Player, Square } from '../core/types.js';

export type EvalFn = (b: Board, p: Player) => number;

/** Thrown to unwind the search quickly once the wall-clock budget is spent. */
class OutOfTime extends Error {}

type TTFlag = 'exact' | 'lower' | 'upper';
/**
 * `complete` records that no line under this node was cut off by the depth
 * limit — every leaf was a finished game — so the stored value or bound would
 * not change at any greater depth.
 */
type TTEntry = Readonly<{
  depth: number;
  value: number;
  flag: TTFlag;
  bestMove: Square;
  complete: boolean;
}>;

/** What one `iterativeDeepen` call found, and how hard it had to look. */
export type SearchResult = Readonly<{
  move: Square;
  /** Deepest iteration that finished; 0 when the move was forced. */
  depth: number;
  /** Every line reached the end of the game: the result is final, not heuristic. */
  complete: boolean;
  /** Nodes visited, across every iteration including an abandoned last one. */
  nodes: number;
}>;

/** Board-plus-side-to-move key. One digit per cell: simple and collision-free. */
function hashKey(b: Board, p: Player): string {
  return b.cells.join('') + p;
}

const CORNERS: ReadonlySet<Square> = new Set([0, 7, 56, 63]);

/** TT-remembered best move first, then corners, then the rest as generated. */
function orderMoves(moves: readonly Square[], hint: Square | undefined): Square[] {
  const corners: Square[] = [];
  const rest: Square[] = [];
  for (const m of moves) {
    if (m === hint) continue;
    (CORNERS.has(m) ? corners : rest).push(m);
  }
  const ordered = [...corners, ...rest];
  return hint !== undefined && moves.includes(hint) ? [hint, ...ordered] : ordered;
}

/**
 * Shared across one search call. `nodes` is checked periodically against the
 * deadline; `horizon` counts the lines the current iteration cut off at the
 * depth limit, so an iteration that finishes with it still at zero has
 * searched the whole remaining game.
 */
type Budget = { nodes: number; deadline: number; horizon: number };

function checkBudget(budget: Budget): void {
  budget.nodes++;
  if ((budget.nodes & 1023) === 0 && Date.now() > budget.deadline) throw new OutOfTime();
}

function alphaBeta(
  b: Board,
  p: Player,
  depth: number,
  alpha: number,
  beta: number,
  tt: Map<string, TTEntry>,
  evalFn: EvalFn,
  budget: Budget,
): number {
  checkBudget(budget);
  // Captured before a TT-tightened window below, so the flag this call
  // eventually stores is judged against the caller's real window — the
  // standard TT-soundness invariant that keeps alpha-beta's result identical
  // to a plain minimax search, just faster.
  const origAlpha = alpha;
  const origBeta = beta;
  const horizonBefore = budget.horizon;

  const key = hashKey(b, p);
  const entry = tt.get(key);
  if (entry && entry.depth >= depth) {
    // A reused value is only as final as the search that produced it.
    if (!entry.complete) budget.horizon++;
    if (entry.flag === 'exact') return entry.value;
    if (entry.flag === 'lower') alpha = Math.max(alpha, entry.value);
    else beta = Math.min(beta, entry.value);
    if (alpha >= beta) return entry.value;
  }

  const moves = legalMoves(b, p);
  if (moves.length === 0) {
    if (legalMoves(b, opponent(p)).length === 0) return evalFn(b, p);
    if (depth <= 0) return horizonLeaf(b, p, evalFn, budget);
    return -alphaBeta(b, opponent(p), depth - 1, -beta, -alpha, tt, evalFn, budget);
  }
  if (depth <= 0) return horizonLeaf(b, p, evalFn, budget);

  const ordered = orderMoves(moves, entry?.bestMove);
  let best = -Infinity;
  let bestMove = ordered[0]!;

  for (const m of ordered) {
    const child = applyMove(b, p, m).board;
    const score = -alphaBeta(child, opponent(p), depth - 1, -beta, -alpha, tt, evalFn, budget);
    if (score > best) {
      best = score;
      bestMove = m;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }

  const flag: TTFlag = best <= origAlpha ? 'upper' : best >= origBeta ? 'lower' : 'exact';
  tt.set(key, { depth, value: best, flag, bestMove, complete: budget.horizon === horizonBefore });
  return best;
}

/** A game still in progress, scored heuristically because the depth ran out. */
function horizonLeaf(b: Board, p: Player, evalFn: EvalFn, budget: Budget): number {
  budget.horizon++;
  return evalFn(b, p);
}

function searchRoot(
  b: Board,
  p: Player,
  depth: number,
  tt: Map<string, TTEntry>,
  evalFn: EvalFn,
  budget: Budget,
): Square {
  const moves = legalMoves(b, p);
  const hint = tt.get(hashKey(b, p))?.bestMove;
  const ordered = orderMoves(moves, hint);

  let alpha = -Infinity;
  const beta = Infinity;
  let bestMove = ordered[0]!;
  let bestValue = -Infinity;

  for (const m of ordered) {
    const child = applyMove(b, p, m).board;
    const score = -alphaBeta(child, opponent(p), depth - 1, -beta, -alpha, tt, evalFn, budget);
    if (score > bestValue) {
      bestValue = score;
      bestMove = m;
    }
    if (bestValue > alpha) alpha = bestValue;
  }

  tt.set(hashKey(b, p), {
    depth,
    value: bestValue,
    flag: 'exact',
    bestMove,
    complete: budget.horizon === 0,
  });
  return bestMove;
}

/**
 * Alpha-beta with a transposition table, deepened one ply at a time until
 * `budgetMs` runs out or `maxDepth` is reached, keeping the best move from
 * the last fully-completed depth. `signal` is checked once per depth, not
 * per node, per the AI boundary spec.
 *
 * Passing `discDiff` as `evalFn` with `maxDepth` generous enough to reach the
 * end of the game (as `findMove` does once few squares are empty) makes this
 * the endgame solver: once an iteration completes at a depth that reaches
 * every terminal line, its value and move are exact, not heuristic.
 *
 * An iteration that cut no line off at the depth limit has searched the whole
 * remaining game, so a deeper one would return the same move: deepening stops
 * there instead of spending the rest of the budget re-proving it. That is
 * what lets a solved endgame reply early rather than always at the deadline.
 */
export function iterativeDeepen(
  b: Board,
  p: Player,
  evalFn: EvalFn,
  budgetMs: number,
  signal: AbortSignal | undefined,
  maxDepth: number,
): SearchResult {
  const moves = legalMoves(b, p);
  if (moves.length === 0) throw new Error('iterativeDeepen called for a player with no legal move');
  if (moves.length === 1) return { move: moves[0]!, depth: 0, complete: false, nodes: 0 };

  const tt = new Map<string, TTEntry>();
  const budget: Budget = { nodes: 0, deadline: Date.now() + budgetMs, horizon: 0 };
  let best = moves[0]!;
  let completed = 0;
  let complete = false;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (signal?.aborted || Date.now() >= budget.deadline) break;
    budget.horizon = 0;
    try {
      best = searchRoot(b, p, depth, tt, evalFn, budget);
    } catch (e) {
      if (e instanceof OutOfTime) break;
      throw e;
    }
    completed = depth;
    if (budget.horizon === 0) {
      complete = true;
      break;
    }
  }
  return { move: best, depth: completed, complete, nodes: budget.nodes };
}
