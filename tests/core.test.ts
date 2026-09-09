import { describe, expect, it } from 'vitest';
import { count, emptyCount, get, initialBoard } from '../src/core/board.js';
import { IllegalMoveError, applyMove, isLegal, legalMoves } from '../src/core/rules.js';
import {
  canUndo,
  currentPosition,
  deserialize,
  newGame,
  play,
  positionAfter,
  serialize,
  undo,
} from '../src/core/game.js';
import { BLACK, EMPTY, PASS, WHITE, squareOf } from '../src/core/types.js';
import type { Game } from '../src/core/game.js';
import type { Square } from '../src/core/types.js';

const sq = (notation: string): Square => {
  const col = notation.charCodeAt(0) - 'a'.charCodeAt(0);
  const row = Number(notation[1]) - 1;
  return squareOf(row, col);
};

const playAll = (g: Game, squares: readonly Square[]): Game =>
  squares.reduce<Game>((acc, s) => play(acc, s), g);

/**
 * The shortest possible game of Othello: nine moves, after which White has no
 * discs left and neither side can move. Found by exhaustive search.
 */
const SHORTEST_GAME: readonly Square[] = [19, 18, 17, 11, 4, 43, 51, 20, 29];

/** After these eight moves the side to move (Black) has no legal move. */
const FORCED_PASS: readonly Square[] = [19, 18, 17, 9, 37, 16, 0, 2];

describe('board', () => {
  it('starts with four discs crosswise in the centre', () => {
    const b = initialBoard();
    expect(get(b, sq('d4'))).toBe(WHITE);
    expect(get(b, sq('e5'))).toBe(WHITE);
    expect(get(b, sq('e4'))).toBe(BLACK);
    expect(get(b, sq('d5'))).toBe(BLACK);
    expect(count(b, BLACK)).toBe(2);
    expect(count(b, WHITE)).toBe(2);
    expect(emptyCount(b)).toBe(60);
  });
});

describe('rules', () => {
  it('gives black four legal opening moves', () => {
    const b = initialBoard();
    expect(legalMoves(b, BLACK).sort((x, y) => x - y)).toEqual(
      [sq('d3'), sq('c4'), sq('f5'), sq('e6')].sort((x, y) => x - y),
    );
  });

  it('flips exactly the bracketed discs', () => {
    const r = applyMove(initialBoard(), BLACK, sq('d3'));
    expect(r.placed).toBe(sq('d3'));
    expect([...r.flipped]).toEqual([sq('d4')]);
    expect(get(r.board, sq('d4'))).toBe(BLACK);
    expect(count(r.board, BLACK)).toBe(4);
    expect(count(r.board, WHITE)).toBe(1);
  });

  it('does not wrap around the board edges', () => {
    const b = initialBoard();
    expect(isLegal(b, BLACK, sq('a1'))).toBe(false);
    expect(isLegal(b, BLACK, sq('h8'))).toBe(false);
    // A move must flip something, and may not land on an occupied square.
    expect(isLegal(b, BLACK, sq('d4'))).toBe(false);
    expect(isLegal(b, BLACK, sq('c3'))).toBe(false);
  });

  it('leaves the source board untouched', () => {
    const b = initialBoard();
    applyMove(b, BLACK, sq('d3'));
    expect(get(b, sq('d3'))).toBe(EMPTY);
    expect(get(b, sq('d4'))).toBe(WHITE);
  });

  it('throws on an illegal square', () => {
    expect(() => applyMove(initialBoard(), BLACK, sq('a1'))).toThrow(IllegalMoveError);
    expect(() => applyMove(initialBoard(), BLACK, sq('d4'))).toThrow(IllegalMoveError);
    expect(() => applyMove(initialBoard(), BLACK, 99)).toThrow(IllegalMoveError);
  });
});

describe('game', () => {
  it('opens with four legal moves for black', () => {
    const pos = currentPosition(newGame(BLACK, 'easy'));
    expect(pos.status).toEqual({ kind: 'turn', player: BLACK });
    expect(pos.legal.length).toBe(4);
    expect(pos.score).toEqual({ black: 2, white: 2 });
  });

  it('memoizes currentPosition per game object', () => {
    const g = newGame(BLACK, 'easy');
    expect(currentPosition(g)).toBe(currentPosition(g));
  });

  it('auto-appends a pass and gives the same colour two turns in a row', () => {
    const g = playAll(newGame(BLACK, 'easy'), FORCED_PASS);

    expect(g.moves).toContain(PASS);
    expect(g.moves.filter((m) => m === PASS).length).toBe(1);
    expect(g.moves[g.moves.length - 1]).toBe(PASS);

    // White moved at ply 8 and, because Black must pass, moves again next.
    const beforePass = positionAfter(g, FORCED_PASS.length);
    expect(beforePass.status).toEqual({ kind: 'turn', player: BLACK });
    expect(beforePass.legal).toEqual([]);

    const after = currentPosition(g);
    expect(after.status).toEqual({ kind: 'turn', player: WHITE });
    expect(after.legal.length).toBeGreaterThan(0);
  });

  it('ends the game when neither player can move, with squares still empty', () => {
    const g = playAll(newGame(BLACK, 'easy'), SHORTEST_GAME);
    const pos = currentPosition(g);

    expect(pos.status).toEqual({ kind: 'over', winner: BLACK });
    expect(emptyCount(pos.board)).toBeGreaterThan(0);
    expect(pos.score).toEqual({ black: 13, white: 0 });
    // The end of the game is not a pass.
    expect(g.moves.filter((m) => m === PASS).length).toBe(0);
    expect(() => play(g, 0)).toThrow();
  });

  it('keeps discs plus empties at 64 through a random playout', () => {
    let seed = 20260909;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };

    for (let round = 0; round < 50; round++) {
      let g = newGame(BLACK, 'easy');
      let pos = currentPosition(g);
      let plies = 0;
      while (pos.status.kind === 'turn') {
        expect(pos.legal.length).toBeGreaterThan(0);
        expect(pos.score.black + pos.score.white + emptyCount(pos.board)).toBe(64);
        g = play(g, pos.legal[rand(pos.legal.length)]!);
        pos = currentPosition(g);
        expect(++plies).toBeLessThan(80);
      }
      expect(pos.score.black + pos.score.white + emptyCount(pos.board)).toBe(64);
    }
  });

  it('undoes back across a pass to the previous human position', () => {
    const g0 = playAll(newGame(BLACK, 'easy'), FORCED_PASS.slice(0, 7));
    expect(currentPosition(g0).status).toEqual({ kind: 'turn', player: WHITE });

    // White's move forces Black to pass, so White is to move again.
    const g1 = play(g0, FORCED_PASS[7]!);
    expect(currentPosition(g1).status).toEqual({ kind: 'turn', player: WHITE });

    // ...and now White plays again, handing the turn back to Black.
    const g2 = play(g1, currentPosition(g1).legal[0]!);
    expect(currentPosition(g2).status).toEqual({ kind: 'turn', player: BLACK });

    // Undo skips past White's two moves and the pass between them, back to
    // the last position where Black actually had something to play.
    const back = undo(g2);
    expect(back.moves).toEqual(FORCED_PASS.slice(0, 6));
    expect(currentPosition(back).status).toEqual({ kind: 'turn', player: BLACK });
    expect(currentPosition(back).legal.length).toBeGreaterThan(0);
    expect([...currentPosition(back).board.cells]).toEqual([
      ...positionAfter(g0, 6).board.cells,
    ]);
  });

  it('undoes to a position where the human is to move, unlimited depth', () => {
    let g = newGame(BLACK, 'easy');
    expect(canUndo(g)).toBe(false);
    expect(undo(g)).toBe(g);

    for (const s of SHORTEST_GAME.slice(0, 6)) g = play(g, s);
    let steps = 0;
    while (canUndo(g)) {
      g = undo(g);
      expect(++steps).toBeLessThan(10);
      if (canUndo(g)) {
        expect(currentPosition(g).status).toEqual({ kind: 'turn', player: BLACK });
      }
    }
    expect(g.moves).toEqual([]);
  });

  it('round-trips through serialize', () => {
    const g = playAll(newGame(BLACK, 'medium'), FORCED_PASS);
    const back = deserialize(serialize(g));
    expect(back).toEqual(g);
    expect([...currentPosition(back!).board.cells]).toEqual([...currentPosition(g).board.cells]);
  });

  it('returns null for anything it cannot use', () => {
    const g = newGame(BLACK, 'easy');
    expect(deserialize('')).toBeNull();
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('null')).toBeNull();
    expect(deserialize('[]')).toBeNull();
    expect(deserialize(JSON.stringify({ ...JSON.parse(serialize(g)), version: 0 }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 1, moves: [], humanColor: 3, difficulty: 'easy' }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 1, moves: [], humanColor: 1, difficulty: 'brutal' }))).toBeNull();
    expect(deserialize(JSON.stringify({ version: 1, moves: 'nope', humanColor: 1, difficulty: 'easy' }))).toBeNull();
    // A move list that does not replay legally.
    expect(deserialize(JSON.stringify({ version: 1, moves: [0], humanColor: 1, difficulty: 'easy' }))).toBeNull();
    // A pass by a player who had a legal move.
    expect(deserialize(JSON.stringify({ version: 1, moves: [PASS], humanColor: 1, difficulty: 'easy' }))).toBeNull();
  });
});
