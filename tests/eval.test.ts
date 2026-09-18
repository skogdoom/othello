import { describe, expect, it } from 'vitest';
import { discDiff, hardEval, mediumEval } from '../src/ai/eval.js';
import { currentPosition, newGame, play } from '../src/core/game.js';
import { BLACK, WHITE } from '../src/core/types.js';
import type { Board } from '../src/core/board.js';

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number): (n: number) => number {
  let s = seed;
  return (n: number) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
}

/** A handful of boards partway through a random game, for eval sanity checks. */
function samplePositions(): Board[] {
  const rand = rng(42);
  const boards: Board[] = [];
  let g = newGame(BLACK, 'hard');
  let pos = currentPosition(g);
  let ply = 0;
  while (pos.status.kind === 'turn') {
    if (ply % 5 === 0) boards.push(pos.board);
    g = play(g, pos.legal[rand(pos.legal.length)]!);
    pos = currentPosition(g);
    ply++;
  }
  return boards;
}

describe('eval', () => {
  it('disc diff is exactly zero-sum', () => {
    for (const b of samplePositions()) {
      expect(discDiff(b, BLACK)).toBeCloseTo(-discDiff(b, WHITE), 9);
    }
  });

  // Negamax relies on evaluate(b, opponent(p)) === -evaluate(b, p): every
  // term the search adds up must swap sign exactly when the side flips, or
  // one side's search would be silently biased against itself.
  it('medium eval is exactly zero-sum', () => {
    for (const b of samplePositions()) {
      expect(mediumEval(b, BLACK)).toBeCloseTo(-mediumEval(b, WHITE), 9);
    }
  });

  it('hard eval is exactly zero-sum', () => {
    for (const b of samplePositions()) {
      expect(hardEval(b, BLACK)).toBeCloseTo(-hardEval(b, WHITE), 9);
    }
  });

  it('values the opening position at zero for both sides', () => {
    const pos = currentPosition(newGame(BLACK, 'hard'));
    expect(mediumEval(pos.board, BLACK)).toBe(0);
    expect(hardEval(pos.board, BLACK)).toBe(0);
  });
});
