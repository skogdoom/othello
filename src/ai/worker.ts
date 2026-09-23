/// <reference lib="webworker" />
import { emptyCount } from '../core/board.js';
import { searchMove } from './index.js';
import { isLevel } from './levels.js';
import type { Board } from '../core/board.js';
import type { SearchReply, SearchRequest } from './protocol.js';

declare const self: DedicatedWorkerGlobalScope;

/**
 * Runs the search off the main thread so a slow search never stalls the flip
 * animation. `findMove` stays synchronous and pure — this file is the
 * message-passing shim the AI boundary was built for, not a rewrite.
 *
 * There is no abort message: a synchronous search cannot see one until it has
 * already finished. The main thread aborts by terminating this worker and
 * starting a fresh one, which is the only way to stop a search mid-call.
 */
self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const { requestId, cells, player, level } = event.data;
  if (!isLevel(level)) return;

  const board: Board = { cells };
  const started = performance.now();
  const result = searchMove(board, player, level);
  const reply: SearchReply = {
    requestId,
    move: result.move,
    stats: {
      level,
      empties: emptyCount(board),
      depth: result.depth,
      complete: result.complete,
      nodes: result.nodes,
      ms: performance.now() - started,
    },
  };
  self.postMessage(reply);
};
