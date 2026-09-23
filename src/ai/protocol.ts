import type { Level } from './levels.js';
import type { Player, Square } from '../core/types.js';

/**
 * The messages between the main thread and the AI worker. Types only, so the
 * worker's own tsconfig program and the DOM one can both import it.
 */
export type SearchRequest = Readonly<{
  requestId: number;
  cells: Int8Array;
  player: Player;
  level: Level;
}>;

/** How one search went, for the `?perf` overlay. */
export type SearchStats = Readonly<{
  level: Level;
  /** Empty squares when the search started, which decides heuristic vs. solve. */
  empties: number;
  /** Deepest iteration that finished; 0 when the move was forced. */
  depth: number;
  /** Every line reached the end of the game: the move is solved, not guessed. */
  complete: boolean;
  nodes: number;
  /** Wall-clock time of the search itself, excluding message passing. */
  ms: number;
}>;

export type SearchReply = Readonly<{
  requestId: number;
  move: Square;
  stats: SearchStats;
}>;
