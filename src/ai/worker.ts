/// <reference lib="webworker" />
import { findMove } from './index.js';
import { isLevel } from './levels.js';
import type { Board } from '../core/board.js';
import type { Player, Square } from '../core/types.js';

declare const self: DedicatedWorkerGlobalScope;

type SearchRequest = Readonly<{
  requestId: number;
  cells: Int8Array;
  player: Player;
  level: string;
}>;

type ControlMessage = Readonly<{ abort: true }>;

/**
 * Runs `findMove` off the main thread so a slow search never stalls the flip
 * animation. `findMove` stays synchronous and pure — this file is the
 * message-passing shim the AI boundary was built for, not a rewrite.
 *
 * A running search cannot truly be interrupted mid-call (JS on this thread
 * cannot preempt itself), so an aborted request simply runs to completion in
 * the background; the main thread's `SearchPort` wrapper drops the reply by
 * `requestId`, and the state machine's epoch guard drops it again for good
 * measure. `currentController` only helps the narrow case where an abort
 * message is queued ahead of a search that has not started yet.
 */
let currentController: AbortController | null = null;

self.onmessage = (event: MessageEvent<SearchRequest | ControlMessage>) => {
  const data = event.data;

  if ('abort' in data) {
    currentController?.abort();
    return;
  }

  currentController?.abort();
  const controller = new AbortController();
  currentController = controller;

  const { requestId, cells, player, level } = data;
  if (!isLevel(level)) return;

  const board: Board = { cells };
  const move: Square = findMove(board, player, level, controller.signal);
  self.postMessage({ requestId, move });
};
