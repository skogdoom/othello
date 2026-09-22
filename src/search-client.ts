import { emptyCount } from './core/board.js';
import type { Board } from './core/board.js';
import type { Player, Square } from './core/types.js';
import type { Level } from './ai/levels.js';
import type { SearchResult } from './ai/search.js';
import type { SearchReply, SearchRequest, SearchStats } from './ai/protocol.js';
import type { SearchPort } from './ports.js';

/** The slice of `Worker` this module uses, so a test can hand it a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<SearchReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: SearchRequest): void;
  terminate(): void;
}

/** `searchMove` from `ai/index.ts`, loaded on the main thread only if the worker fails. */
export type MainThreadSearch = (board: Board, player: Player, level: Level) => SearchResult;

type Job = Readonly<{
  id: number;
  req: Readonly<{ board: Board; player: Player; level: Level }>;
  onDone: (move: Square) => void;
}>;

/**
 * The `SearchPort` the game runs on: the search in a Web Worker.
 *
 * `abort()` terminates the worker when a search is in flight and starts a
 * fresh one. A synchronous search cannot see an abort message until it has
 * finished, so without this an undo during a hard search would make the next
 * reply wait for the discarded one first.
 *
 * If the worker cannot be created or fails at runtime — a host that serves it
 * with the wrong MIME type, a CSP without `worker-src` — the search moves to
 * the main thread for the rest of the session. That stalls the flip animation
 * for the length of a search, but the game stays playable.
 */
export function createSearchClient(
  spawn: () => WorkerLike,
  loadMainThread: () => Promise<MainThreadSearch>,
  onStats: (stats: SearchStats) => void = () => {},
): SearchPort {
  let worker: WorkerLike | null = null;
  let nextId = 0;
  let pending: Job | null = null;
  let mainThread: Promise<MainThreadSearch> | null = null;

  function connect(): WorkerLike | null {
    let w: WorkerLike;
    try {
      w = spawn();
    } catch (error) {
      fallBack(error);
      return null;
    }
    w.onmessage = (event) => {
      const reply = event.data;
      if (!pending || reply.requestId !== pending.id) return; // superseded
      const job = pending;
      pending = null;
      // The move first: a failure in a dev-only stats listener must not stall the game.
      job.onDone(reply.move);
      onStats(reply.stats);
    };
    w.onerror = (event) => {
      event.preventDefault();
      if (w === worker) fallBack(event.message || event);
    };
    return w;
  }

  function fallBack(reason: unknown): void {
    if (mainThread) return;
    console.warn('[search] the AI worker failed; searching on the main thread instead', reason);
    worker?.terminate();
    worker = null;
    mainThread = loadMainThread();
    if (pending) runOnMainThread(pending);
  }

  function runOnMainThread(job: Job): void {
    mainThread!
      .then((search) => {
        // One macrotask of breathing room, so the frame showing the human's
        // move gets painted before the search takes the thread.
        globalThis.setTimeout(() => {
          if (pending !== job) return; // aborted or superseded meanwhile
          const started = performance.now();
          const result = search(job.req.board, job.req.player, job.req.level);
          const ms = performance.now() - started;
          pending = null;
          job.onDone(result.move);
          onStats({
            level: job.req.level,
            empties: emptyCount(job.req.board),
            depth: result.depth,
            complete: result.complete,
            nodes: result.nodes,
            ms,
          });
        }, 0);
      })
      .catch((error: unknown) => {
        console.error('[search] the main-thread search could not be loaded either', error);
      });
  }

  return {
    start(req, onDone) {
      const job: Job = { id: ++nextId, req, onDone };
      pending = job;
      if (mainThread) {
        runOnMainThread(job);
        return;
      }
      // connect() falls back — and reruns `pending` on the main thread — if
      // the worker cannot even be created.
      worker ??= connect();
      worker?.postMessage({
        requestId: job.id,
        cells: req.board.cells,
        player: req.player,
        level: req.level,
      });
    },

    abort() {
      const busy = pending !== null;
      pending = null;
      if (busy && worker) {
        worker.terminate();
        worker = connect();
      }
    },
  };
}
