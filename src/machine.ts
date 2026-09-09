import {
  canUndo,
  currentPosition,
  deserialize,
  newGame,
  play,
  serialize,
  undo,
} from './core/game.js';
import { get } from './core/board.js';
import { applyMove } from './core/rules.js';
import { BLACK, CELLS, EMPTY, PASS, opponent } from './core/types.js';
import type { Game } from './core/game.js';
import type { Move, Player, Square } from './core/types.js';
import type { Level } from './ai/levels.js';
import type {
  AudioPort,
  ClockPort,
  HudPort,
  Phase,
  RendererPort,
  SearchPort,
  StoragePort,
  TimerHandle,
} from './ports.js';

/** Minimum wall time from the human's tap to the AI's move landing. */
export const MIN_AI_DELAY_MS = 400;
/** How long a "player passed" notice stays up. */
export const PASS_NOTICE_MS = 900;

type Token = 'anim' | 'search' | 'minDelay';

export type MachineDeps = Readonly<{
  renderer: RendererPort;
  hud: HudPort;
  audio: AudioPort;
  search: SearchPort;
  clock: ClockPort;
  storage: StoragePort;
  humanColor?: Player;
  difficulty?: Level;
}>;

export interface Machine {
  start(): void;
  tap(square: Square): void;
  undo(): void;
  restart(): void;
  setDifficulty(level: Level): void;
  getPhase(): Phase;
  getGame(): Game;
}

/** Number of PASS entries `after` gained on top of `before`. */
export function trailingPasses(before: Game, after: Game): number {
  let n = 0;
  for (let i = before.moves.length; i < after.moves.length; i++) {
    if (after.moves[i] === PASS) n++;
  }
  return n;
}

export function createMachine(deps: MachineDeps): Machine {
  const { renderer, hud, audio, search, clock, storage } = deps;
  const humanColor: Player = deps.humanColor ?? BLACK;
  const startLevel: Level = deps.difficulty ?? 'easy';

  let game: Game = newGame(humanColor, startLevel);
  let phase: Phase = { kind: 'boot' };

  // Barrier: the resolving phases are joins over a set of outstanding tokens.
  let pending = new Set<Token>();
  let onBarrierDone: (() => void) | null = null;
  let searchResult: Square | null = null;

  // Epoch guard: every async completion carries the epoch it was issued under.
  let epoch = 0;
  const timers = new Set<TimerHandle>();

  let lastMove: Square | null = null;

  const aiColor = (): Player => opponent(game.humanColor);

  function after(ms: number, e: number, fn: () => void): void {
    const handle = clock.setTimeout(() => {
      timers.delete(handle);
      if (e !== epoch) return;
      fn();
    }, ms);
    timers.add(handle);
  }

  function clearTimers(): void {
    for (const h of timers) clock.clearTimeout(h);
    timers.clear();
  }

  function settle(t: Token, e: number): void {
    if (e !== epoch) return;
    if (!pending.delete(t)) return;
    if (pending.size === 0) {
      const done = onBarrierDone;
      onBarrierDone = null;
      done?.();
    }
  }

  function invalidate(): void {
    epoch++;
    search.abort();
    clearTimers();
    pending.clear();
    onBarrierDone = null;
    searchResult = null;
    renderer.snapAnimationsToEnd();
  }

  function persist(): void {
    storage.save(serialize(game));
  }

  /** The only place that touches the outside world. */
  function enter(p: Phase): void {
    phase = p;
    const pos = currentPosition(game);
    renderer.setInputEnabled(p.kind === 'humanTurn');
    renderer.setHints(p.kind === 'humanTurn' ? pos.legal : []);
    renderer.render(pos, lastMove);
    hud.render(pos, phase, canUndo(game));
    persist();
    if (p.kind === 'gameOver') audio.play('end');
  }

  /**
   * Where a move goes once it has landed and finished resolving. `passes` is
   * how many PASS entries the move appended, and `mover` who played it.
   */
  function route(mover: Player | null, passes: number): void {
    const pos = currentPosition(game);

    if (pos.status.kind === 'over') return enter({ kind: 'gameOver' });

    if (passes > 0 && mover !== null) {
      const next = pos.status.player === game.humanColor ? 'human' : 'ai';
      enter({ kind: 'passNotice', by: opponent(mover), next });
      const e = epoch;
      after(PASS_NOTICE_MS, e, () => {
        if (next === 'human') enter({ kind: 'humanTurn' });
        else startAiTurn();
      });
      return;
    }

    if (pos.status.player === game.humanColor) return enter({ kind: 'humanTurn' });
    return startAiTurn();
  }

  /**
   * Commits a move to `game`, arms the barrier and animates it. The move is
   * applied at the moment it is committed, not when the animation ends:
   * `game` is the single source of truth, and an undo landing mid-animation
   * has to find the move already in it.
   *
   * Every token is added before any operation starts, so a port that calls
   * back synchronously cannot clear the barrier before it is fully armed.
   */
  function commit(mover: Player, square: Square, resolving: Phase): void {
    const before = game;
    const result = applyMove(currentPosition(game).board, mover, square);
    game = play(game, square);
    lastMove = square;
    const passes = trailingPasses(before, game);

    const next = currentPosition(game);
    const aiToMove =
      next.status.kind === 'turn' && next.status.player !== game.humanColor;
    const searchHere = aiToMove && resolving.kind === 'humanMoveResolving';

    const e = epoch;
    pending = new Set<Token>(['anim']);
    if (searchHere) {
      pending.add('search');
      pending.add('minDelay');
    }
    onBarrierDone = () => route(mover, passes);

    // One place and one flip per move, never one flip per disc.
    audio.play('place');
    if (result.flipped.length > 0) audio.play('flip', result.flipped.length);
    enter(resolving);

    if (searchHere) {
      // Search and min-delay run concurrently with the flip animation, so on
      // Hard the reply lands ~800 ms after the tap rather than ~1100.
      after(MIN_AI_DELAY_MS, e, () => settle('minDelay', e));
      startSearch(e);
    }

    renderer.animateMove(
      { player: mover, placed: result.placed, flipped: result.flipped },
      () => settle('anim', e),
    );
  }

  function startSearch(e: number): void {
    const pos = currentPosition(game);
    if (pos.status.kind !== 'turn') return;
    search.start(
      { board: pos.board, player: pos.status.player, level: game.difficulty },
      (move) => {
        if (e !== epoch) return; // stale reply after an undo or restart
        searchResult = move;
        settle('search', e);
      },
    );
  }

  function landAiMove(square: Square): void {
    commit(aiColor(), square, { kind: 'aiMoveResolving' });
  }

  /**
   * Waiting for the search is not a phase: it happens inside whatever phase we
   * are already in, and the AI's move lands when search and min-delay are both
   * done.
   */
  function startAiTurn(): void {
    const prefetched = searchResult;
    searchResult = null;
    if (prefetched !== null) return landAiMove(prefetched);

    const e = epoch;
    pending = new Set<Token>(['search', 'minDelay']);
    onBarrierDone = () => {
      const move = searchResult;
      searchResult = null;
      if (move === null) return;
      landAiMove(move);
    };
    after(MIN_AI_DELAY_MS, e, () => settle('minDelay', e));
    startSearch(e);
  }

  function bootGame(): Game {
    const saved = storage.load();
    if (saved !== null) {
      const restored = deserialize(saved);
      if (restored !== null) return restored;
    }
    return newGame(humanColor, startLevel);
  }

  function lastPlacedOf(g: Game): Square | null {
    for (let i = g.moves.length - 1; i >= 0; i--) {
      const m: Move | undefined = g.moves[i];
      if (m !== undefined && m !== PASS) return m;
    }
    return null;
  }

  return {
    start(): void {
      game = bootGame();
      lastMove = lastPlacedOf(game);
      const pos = currentPosition(game);
      if (pos.status.kind === 'over') return enter({ kind: 'gameOver' });
      if (pos.status.player === game.humanColor) return enter({ kind: 'humanTurn' });
      // A resumed game with the AI to move must start a search on load,
      // otherwise it looks frozen after a refresh.
      enter({ kind: 'boot' });
      startAiTurn();
    },

    tap(square: Square): void {
      if (phase.kind !== 'humanTurn') return;
      const pos = currentPosition(game);
      if (pos.status.kind !== 'turn') return;
      if (square < 0 || square >= CELLS) return;

      if (get(pos.board, square) !== EMPTY) {
        audio.play('invalid');
        return;
      }
      if (!pos.legal.includes(square)) return; // empty but not legal: silent

      commit(pos.status.player, square, { kind: 'humanMoveResolving' });
    },

    undo(): void {
      if (phase.kind === 'boot' || !canUndo(game)) return;
      invalidate();
      game = undo(game);
      lastMove = lastPlacedOf(game);
      const pos = currentPosition(game);
      if (pos.status.kind === 'turn' && pos.status.player !== game.humanColor) {
        // Only reachable if the human plays white: the opening belongs to the AI.
        enter({ kind: 'boot' });
        return startAiTurn();
      }
      enter({ kind: 'humanTurn' });
    },

    restart(): void {
      invalidate();
      game = newGame(game.humanColor, game.difficulty);
      lastMove = null;
      const pos = currentPosition(game);
      if (pos.status.kind === 'turn' && pos.status.player === game.humanColor) {
        enter({ kind: 'humanTurn' });
      } else {
        enter({ kind: 'boot' });
        startAiTurn();
      }
    },

    setDifficulty(level: Level): void {
      game = { ...game, difficulty: level };
      if (phase.kind === 'humanMoveResolving') {
        // The human's move is already in `game`; only the pending search is stale.
        invalidate();
        startAiTurn();
        return;
      }
      enter(phase);
    },

    getPhase: () => phase,
    getGame: () => game,
  };
}
