import { beforeEach, describe, expect, it } from 'vitest';
import { MIN_AI_DELAY_MS, PASS_NOTICE_MS, createMachine } from '../src/machine.js';
import { currentPosition, newGame, play, serialize } from '../src/core/game.js';
import { BLACK, WHITE } from '../src/core/types.js';
import type { Machine } from '../src/machine.js';
import type { Game } from '../src/core/game.js';
import type { Square } from '../src/core/types.js';
import {
  FakeAudio,
  FakeClock,
  FakeHud,
  FakeRenderer,
  FakeSearch,
  FakeStorage,
} from './fakes.js';

/** After these eight moves the side to move (Black) has no legal move. */
const FORCED_PASS: readonly Square[] = [19, 18, 17, 9, 37, 16, 0, 2];

function setup(saved: string | null = null) {
  const renderer = new FakeRenderer();
  const hud = new FakeHud();
  const audio = new FakeAudio();
  const search = new FakeSearch();
  const clock = new FakeClock();
  const storage = new FakeStorage(saved);
  const machine: Machine = createMachine({
    renderer,
    hud,
    audio,
    search,
    clock,
    storage,
    humanColor: BLACK,
    difficulty: 'easy',
  });
  return { renderer, hud, audio, search, clock, storage, machine };
}

const legalOf = (m: Machine): readonly Square[] => currentPosition(m.getGame()).legal;
const aiReply = (m: Machine): Square => legalOf(m)[0]!;

describe('state machine', () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
    env.machine.start();
  });

  it('boots a fresh game into the human turn with input and hints on', () => {
    const { machine, renderer } = env;
    expect(machine.getPhase()).toEqual({ kind: 'humanTurn' });
    expect(renderer.inputEnabled).toBe(true);
    expect(renderer.hints.length).toBe(4);
    expect(machine.getGame().moves).toEqual([]);
  });

  it('applies the human move immediately and disables input while it resolves', () => {
    const { machine, renderer } = env;
    const move = legalOf(machine)[0]!;
    machine.tap(move);

    expect(machine.getPhase()).toEqual({ kind: 'humanMoveResolving' });
    expect(machine.getGame().moves).toEqual([move]);
    expect(renderer.inputEnabled).toBe(false);
    expect(renderer.hints).toEqual([]);
  });

  it('lands the AI move when the search returns before the animation', () => {
    const { machine, renderer, search, clock } = env;
    machine.tap(legalOf(machine)[0]!);
    const reply = aiReply(machine);

    search.complete(reply);
    clock.tick(MIN_AI_DELAY_MS);
    expect(machine.getGame().moves.length).toBe(1); // still animating

    renderer.finishAnimations();
    expect(machine.getGame().moves).toEqual([machine.getGame().moves[0]!, reply]);
    expect(machine.getPhase()).toEqual({ kind: 'aiMoveResolving' });

    renderer.finishAnimations();
    expect(machine.getPhase()).toEqual({ kind: 'humanTurn' });
    expect(machine.getGame().moves.length).toBe(2);
  });

  it('lands the AI move when the search returns after the animation', () => {
    const { machine, renderer, search, clock } = env;
    machine.tap(legalOf(machine)[0]!);
    const reply = aiReply(machine);

    renderer.finishAnimations();
    clock.tick(MIN_AI_DELAY_MS);
    expect(machine.getGame().moves.length).toBe(1);

    search.complete(reply);
    expect(machine.getGame().moves.length).toBe(2);
    expect(machine.getGame().moves[1]).toBe(reply);

    renderer.finishAnimations();
    expect(machine.getPhase()).toEqual({ kind: 'humanTurn' });
    expect(machine.getGame().moves.length).toBe(2);
  });

  it('holds the AI move until the minimum delay has passed', () => {
    const { machine, renderer, search, clock } = env;
    machine.tap(legalOf(machine)[0]!);

    search.complete(aiReply(machine));
    renderer.finishAnimations();
    expect(machine.getGame().moves.length).toBe(1);

    clock.tick(MIN_AI_DELAY_MS - 1);
    expect(machine.getGame().moves.length).toBe(1);
    clock.tick(1);
    expect(machine.getGame().moves.length).toBe(2);
  });

  it('applies exactly one move on a rapid double tap', () => {
    const { machine, audio } = env;
    const move = legalOf(machine)[0]!;
    machine.tap(move);
    machine.tap(move);
    machine.tap(legalOf(machine)[0]!);

    expect(machine.getGame().moves).toEqual([move]);
    expect(audio.played.filter((s) => s === 'place').length).toBe(1);
  });

  it('buzzes on an occupied square and stays silent on an empty illegal one', () => {
    const { machine, audio } = env;
    machine.tap(27); // d4, occupied
    expect(audio.played).toEqual(['invalid']);
    expect(machine.getGame().moves).toEqual([]);

    audio.played.length = 0;
    machine.tap(0); // a1, empty but not legal
    expect(audio.played).toEqual([]);
    expect(machine.getGame().moves).toEqual([]);
  });

  it('discards a stale search reply after an undo', () => {
    const { machine, search, renderer, clock } = env;
    const move = legalOf(machine)[0]!;
    machine.tap(move);
    const stale = aiReply(machine);

    machine.undo();
    expect(machine.getPhase()).toEqual({ kind: 'humanTurn' });
    expect(machine.getGame().moves).toEqual([]);
    expect(search.aborts).toBe(1);
    expect(renderer.snaps).toBe(1);

    search.respond(stale);
    clock.tick(MIN_AI_DELAY_MS * 4);
    renderer.finishAnimations();

    expect(machine.getGame().moves).toEqual([]);
    expect(machine.getPhase()).toEqual({ kind: 'humanTurn' });
    expect([...currentPosition(machine.getGame()).board.cells]).toEqual([
      ...currentPosition(newGame(BLACK, 'easy')).board.cells,
    ]);
  });

  it('restarts cleanly during a pass notice', () => {
    // Preload a game in which White is to move and forces Black to pass.
    let g: Game = newGame(BLACK, 'easy');
    for (const s of FORCED_PASS.slice(0, 7)) g = play(g, s);

    const local = setup(serialize(g));
    local.machine.start();

    // The AI is to move on boot, so a search must already be running.
    expect(local.search.pending).toBe(true);
    local.search.complete(FORCED_PASS[7]!);
    local.clock.tick(MIN_AI_DELAY_MS);
    local.renderer.finishAnimations();

    expect(local.machine.getPhase()).toEqual({
      kind: 'passNotice',
      by: BLACK,
      next: 'ai',
    });

    local.machine.restart();
    expect(local.machine.getPhase()).toEqual({ kind: 'humanTurn' });
    expect(local.machine.getGame().moves).toEqual([]);

    const searchesBefore = local.search.requests.length;
    local.clock.tick(PASS_NOTICE_MS * 2);

    // The queued pass-notice transition must not fire on the new game.
    expect(local.machine.getPhase()).toEqual({ kind: 'humanTurn' });
    expect(local.machine.getGame().moves).toEqual([]);
    expect(local.search.requests.length).toBe(searchesBefore);
  });

  it('shows a pass notice and hands the turn back', () => {
    let g: Game = newGame(BLACK, 'easy');
    for (const s of FORCED_PASS.slice(0, 7)) g = play(g, s);

    const local = setup(serialize(g));
    local.machine.start();
    local.search.complete(FORCED_PASS[7]!);
    local.clock.tick(MIN_AI_DELAY_MS);
    local.renderer.finishAnimations();

    expect(local.machine.getGame().moves.length).toBe(9); // move + auto pass
    expect(local.machine.getPhase().kind).toBe('passNotice');

    local.clock.tick(PASS_NOTICE_MS);
    // White moves again after Black's pass, so a second search starts.
    expect(local.search.pending).toBe(true);
    expect(local.search.lastRequest?.player).toBe(WHITE);
  });

  it('starts a search on boot when a resumed game has the AI to move', () => {
    let g: Game = newGame(BLACK, 'easy');
    g = play(g, currentPosition(g).legal[0]!);

    const local = setup(serialize(g));
    local.machine.start();

    expect(local.search.pending).toBe(true);
    expect(local.search.lastRequest?.player).toBe(WHITE);
    expect(local.renderer.inputEnabled).toBe(false);
  });

  it('resumes a finished game straight into game over', () => {
    let g: Game = newGame(BLACK, 'easy');
    for (const s of [19, 18, 17, 11, 4, 43, 51, 20, 29]) g = play(g, s);

    const local = setup(serialize(g));
    local.machine.start();

    expect(local.machine.getPhase()).toEqual({ kind: 'gameOver' });
    expect(local.audio.played).toEqual(['end']);
    expect(local.search.pending).toBe(false);
  });

  it('persists on every phase entry', () => {
    const { machine, storage } = env;
    expect(storage.saved).not.toBeNull();
    machine.tap(legalOf(machine)[0]!);
    expect(JSON.parse(storage.saved!).moves.length).toBe(1);
  });

  it('re-searches with the new level when difficulty changes mid-resolve', () => {
    const { machine, search, clock, renderer } = env;
    machine.tap(legalOf(machine)[0]!);
    expect(search.lastRequest?.level).toBe('easy');

    machine.setDifficulty('hard');
    expect(search.aborts).toBe(1);
    expect(search.requests.length).toBe(2);
    expect(search.lastRequest?.level).toBe('hard');
    expect(machine.getGame().moves.length).toBe(1); // the human's move survives

    search.complete(aiReply(machine));
    clock.tick(MIN_AI_DELAY_MS);
    renderer.finishAnimations();
    expect(machine.getGame().moves.length).toBe(2);
  });

  it('plays a full game to a finished position', () => {
    const { machine, renderer, search, clock } = env;
    let guard = 0;
    while (machine.getPhase().kind !== 'gameOver') {
      const phase = machine.getPhase();
      if (phase.kind === 'humanTurn') machine.tap(legalOf(machine)[0]!);
      if (search.pending) search.complete(aiReply(machine));
      clock.tick(MIN_AI_DELAY_MS + PASS_NOTICE_MS);
      renderer.finishAnimations();
      expect(++guard).toBeLessThan(200);
    }
    const pos = currentPosition(machine.getGame());
    expect(pos.status.kind).toBe('over');
    expect(pos.score.black + pos.score.white).toBeGreaterThan(4);
  });
});
