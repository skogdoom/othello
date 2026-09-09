import type { Position } from './core/game.js';
import type { Player, Square } from './core/types.js';
import type { Level } from './ai/levels.js';
import type { Board } from './core/board.js';

export type SoundName = 'place' | 'flip' | 'invalid' | 'end';

export type Phase =
  | Readonly<{ kind: 'boot' }>
  | Readonly<{ kind: 'humanTurn' }>
  | Readonly<{ kind: 'humanMoveResolving' }>
  | Readonly<{ kind: 'aiMoveResolving' }>
  | Readonly<{ kind: 'passNotice'; by: Player; next: 'human' | 'ai' }>
  | Readonly<{ kind: 'gameOver' }>;

export type AnimatedMove = Readonly<{
  player: Player;
  placed: Square;
  flipped: readonly Square[];
}>;

export interface RendererPort {
  /** Full redraw from the authoritative position. */
  render(pos: Position, lastMove: Square | null): void;
  /** S1 completes immediately; S2 runs the flip cascade. */
  animateMove(move: AnimatedMove, done: () => void): void;
  /** Jump every running animation to its end state (never cancel mid-flip). */
  snapAnimationsToEnd(): void;
  setInputEnabled(enabled: boolean): void;
  setHints(squares: readonly Square[]): void;
}

export interface HudPort {
  render(pos: Position, phase: Phase, canUndo: boolean): void;
}

export interface AudioPort {
  play(sound: SoundName): void;
}

export interface SearchPort {
  /** Must not call `onDone` after `abort()`. */
  start(
    req: Readonly<{ board: Board; player: Player; level: Level }>,
    onDone: (move: Square) => void,
  ): void;
  abort(): void;
}

export type TimerHandle = number;

export interface ClockPort {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface StoragePort {
  save(json: string): void;
  load(): string | null;
}
