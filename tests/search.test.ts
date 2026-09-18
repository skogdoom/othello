import { describe, expect, it } from 'vitest';
import { discDiff, mediumEval } from '../src/ai/eval.js';
import { iterativeDeepen } from '../src/ai/search.js';
import { currentPosition, newGame, play } from '../src/core/game.js';
import { BLACK } from '../src/core/types.js';

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number): (n: number) => number {
  let s = seed;
  return (n: number) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
}

describe('iterativeDeepen', () => {
  it('returns a legal move within a tiny budget', () => {
    const pos = currentPosition(newGame(BLACK, 'medium'));
    const move = iterativeDeepen(pos.board, BLACK, mediumEval, 5, undefined, 10);
    expect(pos.legal).toContain(move);
  });

  it('does not overrun an already-expired budget', () => {
    const pos = currentPosition(newGame(BLACK, 'medium'));
    const start = Date.now();
    const move = iterativeDeepen(pos.board, BLACK, mediumEval, 0, undefined, 10);
    expect(pos.legal).toContain(move);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('honours an already-aborted signal by returning after depth 1', () => {
    const pos = currentPosition(newGame(BLACK, 'medium'));
    const controller = new AbortController();
    controller.abort();
    const move = iterativeDeepen(pos.board, BLACK, mediumEval, 1000, controller.signal, 10);
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
    const solved = iterativeDeepen(pos.board, pos.status.player, discDiff, 50, undefined, 30);
    expect(pos.legal).toContain(solved);
  });
});
