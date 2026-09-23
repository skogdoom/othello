import { describe, expect, it } from 'vitest';
import { discDiff, mediumEval } from '../src/ai/eval.js';
import { iterativeDeepen } from '../src/ai/search.js';
import { currentPosition, newGame, play } from '../src/core/game.js';
import { applyMove, legalMoves } from '../src/core/rules.js';
import { BLACK, opponent } from '../src/core/types.js';
import type { Board } from '../src/core/board.js';
import type { Game, Position } from '../src/core/game.js';
import type { Player } from '../src/core/types.js';

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number): (n: number) => number {
  let s = seed;
  return (n: number) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
}

/** Plays a seeded random game until `empties` squares or fewer are left. */
function randomPositionWith(empties: number, seed: number): Position | null {
  const rand = rng(seed);
  let g: Game = newGame(BLACK, 'hard');
  let pos = currentPosition(g);
  while (pos.status.kind === 'turn' && pos.board.cells.filter((c) => c === 0).length > empties) {
    g = play(g, pos.legal[rand(pos.legal.length)]!);
    pos = currentPosition(g);
  }
  return pos.status.kind === 'turn' ? pos : null;
}

/** Reference solver: plain negamax to the end of the game, no pruning, no table. */
function solve(b: Board, p: Player): number {
  const moves = legalMoves(b, p);
  if (moves.length === 0) {
    if (legalMoves(b, opponent(p)).length === 0) return discDiff(b, p);
    return -solve(b, opponent(p));
  }
  let best = -Infinity;
  for (const m of moves) best = Math.max(best, -solve(applyMove(b, p, m).board, opponent(p)));
  return best;
}

describe('iterativeDeepen', () => {
  it('returns a legal move within a tiny budget', () => {
    const pos = currentPosition(newGame(BLACK, 'medium'));
    const move = iterativeDeepen(pos.board, BLACK, mediumEval, 5, undefined, 10).move;
    expect(pos.legal).toContain(move);
  });

  it('does not overrun an already-expired budget', () => {
    const pos = currentPosition(newGame(BLACK, 'medium'));
    const start = Date.now();
    const move = iterativeDeepen(pos.board, BLACK, mediumEval, 0, undefined, 10).move;
    expect(pos.legal).toContain(move);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('honours an already-aborted signal by returning after depth 1', () => {
    const pos = currentPosition(newGame(BLACK, 'medium'));
    const controller = new AbortController();
    controller.abort();
    const move = iterativeDeepen(pos.board, BLACK, mediumEval, 1000, controller.signal, 10).move;
    expect(pos.legal).toContain(move);
  });

  it('with discDiff as eval and a generous depth, still returns a legal move near the endgame', () => {
    // Play a random game down to a handful of empty squares, then exact-solve
    // from there — the same call shape `findMove` uses for the endgame.
    const rand = rng(7);
    let g = newGame(BLACK, 'hard');
    let pos = currentPosition(g);
    while (pos.status.kind === 'turn' && pos.board.cells.filter((c) => c === 0).length > 10) {
      g = play(g, pos.legal[rand(pos.legal.length)]!);
      pos = currentPosition(g);
    }
    if (pos.status.kind !== 'turn') return; // the random game ended early; nothing to solve
    const solved = iterativeDeepen(pos.board, pos.status.player, discDiff, 50, undefined, 30).move;
    expect(pos.legal).toContain(solved);
  });

  it('stops deepening once the whole game is solved, with the exactly best move', () => {
    for (const seed of [3, 11, 19, 42]) {
      const pos = randomPositionWith(9, seed);
      if (!pos || pos.status.kind !== 'turn') continue;
      const p = pos.status.player;

      const start = Date.now();
      const result = iterativeDeepen(pos.board, p, discDiff, 10_000, undefined, 40);
      expect(Date.now() - start).toBeLessThan(5_000); // well short of the budget

      if (pos.legal.length > 1) {
        expect(result.complete).toBe(true);
        expect(result.depth).toBeLessThan(40);
      }
      const best = solve(pos.board, p);
      expect(-solve(applyMove(pos.board, p, result.move).board, opponent(p))).toBe(best);
    }
  });

  it('reports a midgame search as incomplete, with the depth it reached', () => {
    const pos = randomPositionWith(40, 5)!;
    expect(pos.status.kind).toBe('turn');
    if (pos.status.kind !== 'turn') return;
    const result = iterativeDeepen(pos.board, pos.status.player, mediumEval, 10_000, undefined, 3);
    expect(result.complete).toBe(false);
    expect(result.depth).toBe(3);
    expect(result.nodes).toBeGreaterThan(0);
  });

  it('reports a forced move without searching', () => {
    // Find a position with exactly one legal move by random play.
    for (let seed = 1; seed < 200; seed++) {
      const rand = rng(seed);
      let g: Game = newGame(BLACK, 'hard');
      let pos = currentPosition(g);
      while (pos.status.kind === 'turn' && pos.legal.length !== 1) {
        g = play(g, pos.legal[rand(pos.legal.length)]!);
        pos = currentPosition(g);
      }
      if (pos.status.kind !== 'turn') continue;
      const result = iterativeDeepen(pos.board, pos.status.player, mediumEval, 1000, undefined, 10);
      expect(result).toEqual({ move: pos.legal[0], depth: 0, complete: false, nodes: 0 });
      return;
    }
    throw new Error('no position with a single legal move found');
  });
});
