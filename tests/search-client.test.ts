import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchClient } from '../src/search-client.js';
import { currentPosition, newGame } from '../src/core/game.js';
import { BLACK, WHITE } from '../src/core/types.js';
import type { MainThreadSearch, WorkerLike } from '../src/search-client.js';
import type { SearchReply, SearchRequest, SearchStats } from '../src/ai/protocol.js';
import type { Player, Square } from '../src/core/types.js';
import type { Level } from '../src/ai/levels.js';

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<SearchReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: SearchRequest[] = [];
  terminated = false;

  postMessage(message: SearchRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers the most recent request, as the real worker would. */
  reply(move: Square, requestId = this.posted[this.posted.length - 1]!.requestId): void {
    const stats: SearchStats = {
      level: 'hard',
      empties: 60,
      depth: 7,
      complete: false,
      nodes: 1234,
      ms: 800,
    };
    this.onmessage?.({ data: { requestId, move, stats } } as MessageEvent<SearchReply>);
  }

  fail(): void {
    this.onerror?.({ message: 'boom', preventDefault() {} } as ErrorEvent);
  }
}

const start = currentPosition(newGame(BLACK, 'hard'));
const req: { board: typeof start.board; player: Player; level: Level } = {
  board: start.board,
  player: BLACK,
  level: 'hard',
};

function setup(spawnThrows = false) {
  const workers: FakeWorker[] = [];
  const spawn = () => {
    if (spawnThrows) throw new Error('no workers here');
    const w = new FakeWorker();
    workers.push(w);
    return w;
  };
  const mainThread = vi.fn<MainThreadSearch>(() => ({
    move: start.legal[1]!,
    depth: 3,
    complete: false,
    nodes: 99,
  }));
  const stats: SearchStats[] = [];
  const client = createSearchClient(
    spawn,
    () => Promise.resolve(mainThread),
    (s) => stats.push(s),
  );
  return { workers, mainThread, stats, client };
}

describe('search client', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates one worker lazily and reuses it across searches', () => {
    const { workers, client } = setup();
    expect(workers.length).toBe(0);

    const moves: Square[] = [];
    client.start(req, (m) => moves.push(m));
    workers[0]!.reply(19);
    client.start({ ...req, player: WHITE }, (m) => moves.push(m));
    workers[0]!.reply(18);

    expect(workers.length).toBe(1);
    expect(moves).toEqual([19, 18]);
    expect(workers[0]!.posted.map((p) => p.player)).toEqual([BLACK, WHITE]);
  });

  it('forwards the stats that come back with each move', () => {
    const { workers, client, stats } = setup();
    client.start(req, () => {});
    workers[0]!.reply(19);
    expect(stats).toEqual([expect.objectContaining({ level: 'hard', depth: 7, nodes: 1234 })]);
  });

  it('terminates a busy worker on abort and never delivers its reply', () => {
    const { workers, client } = setup();
    const onDone = vi.fn();
    client.start(req, onDone);
    const first = workers[0]!;

    client.abort();
    expect(first.terminated).toBe(true);
    expect(workers.length).toBe(2); // a fresh one, warming up for the next search

    first.reply(19); // a reply already in flight when it was terminated
    expect(onDone).not.toHaveBeenCalled();

    const next = vi.fn();
    client.start(req, next);
    workers[1]!.reply(26);
    expect(next).toHaveBeenCalledWith(26);
  });

  it('keeps an idle worker on abort', () => {
    const { workers, client } = setup();
    client.start(req, () => {});
    workers[0]!.reply(19);

    client.abort();
    expect(workers[0]!.terminated).toBe(false);
    expect(workers.length).toBe(1);
  });

  it('drops a reply for a superseded request', () => {
    const { workers, client } = setup();
    const first = vi.fn();
    const second = vi.fn();
    client.start(req, first);
    client.start(req, second);

    workers[0]!.reply(19, 1);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    workers[0]!.reply(26, 2);
    expect(second).toHaveBeenCalledWith(26);
  });

  it('reruns the pending search on the main thread when the worker fails', async () => {
    vi.useFakeTimers();
    const { workers, client, mainThread, stats } = setup();
    const onDone = vi.fn();
    client.start(req, onDone);

    workers[0]!.fail();
    expect(workers[0]!.terminated).toBe(true);
    await vi.runAllTimersAsync();

    expect(mainThread).toHaveBeenCalledWith(req.board, BLACK, 'hard');
    expect(onDone).toHaveBeenCalledWith(start.legal[1]);
    expect(stats.at(-1)).toEqual(expect.objectContaining({ depth: 3, nodes: 99, empties: 60 }));

    // Later searches go straight to the main thread.
    const later = vi.fn();
    client.start(req, later);
    await vi.runAllTimersAsync();
    expect(later).toHaveBeenCalledWith(start.legal[1]);
    expect(workers.length).toBe(1);
  });

  it('falls back when a worker cannot be created at all', async () => {
    vi.useFakeTimers();
    const { client, mainThread } = setup(true);
    const onDone = vi.fn();
    client.start(req, onDone);
    await vi.runAllTimersAsync();

    expect(mainThread).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(start.legal[1]);
  });

  it('does not deliver a main-thread result after an abort', async () => {
    vi.useFakeTimers();
    const { client, mainThread } = setup(true);
    const onDone = vi.fn();
    client.start(req, onDone);
    client.abort();
    await vi.runAllTimersAsync();

    expect(mainThread).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
