import { count, initialBoard } from './board.js';
import { applyMove, legalMoves } from './rules.js';
import { BLACK, PASS, WHITE, opponent } from './types.js';
import type { Board } from './board.js';
import type { Move, Player, Square } from './types.js';
import type { Level } from '../ai/levels.js';
import { isLevel } from '../ai/levels.js';

export type Game = Readonly<{
  moves: readonly Move[];
  humanColor: Player;
  difficulty: Level;
}>;

export type Status =
  | Readonly<{ kind: 'turn'; player: Player }>
  | Readonly<{ kind: 'over'; winner: Player | null }>;

export type Position = Readonly<{
  board: Board;
  status: Status;
  legal: readonly Square[];
  score: Readonly<{ black: number; white: number }>;
}>;

export function newGame(humanColor: Player, difficulty: Level): Game {
  return { moves: [], humanColor, difficulty };
}

/** Replays `moves` onto the start position. Throws on an illegal move list. */
function replay(moves: readonly Move[]): { board: Board; player: Player } {
  let board = initialBoard();
  let player: Player = BLACK;
  for (const m of moves) {
    if (m === PASS) {
      // A pass is only legitimate when the side to move genuinely has none,
      // so a tampered save with a spurious PASS fails to replay.
      if (legalMoves(board, player).length > 0) {
        throw new Error('Illegal pass in move list');
      }
      player = opponent(player);
      continue;
    }
    board = applyMove(board, player, m).board;
    player = opponent(player);
  }
  return { board, player };
}

function positionOf(board: Board, player: Player): Position {
  const legal = legalMoves(board, player);
  const black = count(board, BLACK);
  const white = count(board, WHITE);
  const score = { black, white };

  if (legal.length === 0 && legalMoves(board, opponent(player)).length === 0) {
    const winner = black === white ? null : black > white ? BLACK : WHITE;
    return { board, status: { kind: 'over', winner }, legal: [], score };
  }
  return { board, status: { kind: 'turn', player }, legal, score };
}

const positionCache = new WeakMap<Game, Position>();

export function currentPosition(g: Game): Position {
  const cached = positionCache.get(g);
  if (cached) return cached;
  const { board, player } = replay(g.moves);
  const pos = positionOf(board, player);
  positionCache.set(g, pos);
  return pos;
}

export function positionAfter(g: Game, plies: number): Position {
  const n = Math.max(0, Math.min(plies, g.moves.length));
  if (n === g.moves.length) return currentPosition(g);
  const { board, player } = replay(g.moves.slice(0, n));
  return positionOf(board, player);
}

/**
 * Applies the human's or AI's move, then appends `PASS` for every subsequent
 * side to move that has none — so the returned game is always either over or
 * on the turn of a player who can actually move.
 */
export function play(g: Game, s: Square): Game {
  const pos = currentPosition(g);
  if (pos.status.kind !== 'turn') {
    throw new Error(`Cannot play: the game is over`);
  }
  const mover = pos.status.player;
  const result = applyMove(pos.board, mover, s);

  const moves: Move[] = [...g.moves, s];
  let board = result.board;
  let next = opponent(mover);

  while (legalMoves(board, next).length === 0) {
    // Neither side can move: the game is over, and an end is not a pass.
    if (legalMoves(board, opponent(next)).length === 0) break;
    moves.push(PASS);
    next = opponent(next);
  }

  return { ...g, moves };
}

/**
 * True when `moves` leaves the human on move *with something to play*. The
 * "legal move" part matters: a move list that has not yet had its auto-passes
 * appended can put the human on move with an empty legal list, and stopping
 * there would hand back a position the player cannot act on.
 */
function humanCanMoveAt(moves: readonly Move[], humanColor: Player): boolean {
  const { board, player } = replay(moves);
  if (player !== humanColor) return false;
  const pos = positionOf(board, player);
  return pos.status.kind === 'turn' && pos.legal.length > 0;
}

export function canUndo(g: Game): boolean {
  return g.moves.length > 0;
}

/** Pops back to the last position at which the human was to move. */
export function undo(g: Game): Game {
  if (!canUndo(g)) return g;
  const moves = [...g.moves];
  do {
    moves.pop();
  } while (moves.length > 0 && !humanCanMoveAt(moves, g.humanColor));
  return { ...g, moves };
}

const SAVE_VERSION = 1;

type Saved = {
  version: number;
  moves: number[];
  humanColor: Player;
  difficulty: Level;
};

export function serialize(g: Game): string {
  const saved: Saved = {
    version: SAVE_VERSION,
    moves: [...g.moves],
    humanColor: g.humanColor,
    difficulty: g.difficulty,
  };
  return JSON.stringify(saved);
}

/** Returns `null` on anything it cannot parse, validate or replay. */
export function deserialize(json: string): Game | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;

  const o = raw as Record<string, unknown>;
  if (o['version'] !== SAVE_VERSION) return null;
  if (o['humanColor'] !== BLACK && o['humanColor'] !== WHITE) return null;
  if (!isLevel(o['difficulty'])) return null;
  if (!Array.isArray(o['moves'])) return null;

  const moves: Move[] = [];
  for (const m of o['moves'] as unknown[]) {
    if (typeof m !== 'number' || !Number.isInteger(m)) return null;
    if (m !== PASS && (m < 0 || m > 63)) return null;
    moves.push(m);
  }

  try {
    replay(moves);
  } catch {
    return null;
  }

  return {
    moves,
    humanColor: o['humanColor'],
    difficulty: o['difficulty'],
  };
}
