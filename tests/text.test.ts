import { describe, expect, it } from 'vitest';
import { resultText, scoreText, statusText } from '../src/ui/text.js';
import { currentPosition, newGame, play } from '../src/core/game.js';
import { BLACK, WHITE } from '../src/core/types.js';
import type { Game } from '../src/core/game.js';

const SHORTEST_GAME = [19, 18, 17, 11, 4, 43, 51, 20, 29];

const finished = (): Game => {
  let g = newGame(BLACK, 'easy');
  for (const s of SHORTEST_GAME) g = play(g, s);
  return g;
};

describe('hud text', () => {
  it('names whose turn it is', () => {
    const pos = currentPosition(newGame(BLACK, 'easy'));
    expect(statusText(pos, { kind: 'humanTurn' })).toBe('Your turn');
    expect(statusText(pos, { kind: 'humanMoveResolving' })).toBe('Black is thinking…');
  });

  it('says who passed, not whose turn it is', () => {
    const pos = currentPosition(newGame(BLACK, 'easy'));
    expect(statusText(pos, { kind: 'passNotice', by: WHITE, next: 'human' })).toBe(
      'White has no move — passing',
    );
  });

  it('reports the result once the game is over', () => {
    const pos = currentPosition(finished());
    expect(pos.status.kind).toBe('over');
    expect(resultText(pos)).toBe('Black wins');
    expect(scoreText(pos)).toBe('13 – 0');
    expect(statusText(pos, { kind: 'gameOver' })).toBe('Black wins');
  });

  it('has no result to report while the game is running', () => {
    expect(resultText(currentPosition(newGame(BLACK, 'easy')))).toBe('');
  });
});
