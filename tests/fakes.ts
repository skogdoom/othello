import type {
  AnimatedMove,
  AudioPort,
  ClockPort,
  HudPort,
  Phase,
  RendererPort,
  SearchPort,
  SoundName,
  StoragePort,
  TimerHandle,
} from '../src/ports.js';
import type { Position } from '../src/core/game.js';
import type { Board, } from '../src/core/board.js';
import type { Player, Square } from '../src/core/types.js';
import type { Level } from '../src/ai/levels.js';

export class FakeClock implements ClockPort {
  private next = 1;
  private readonly timers = new Map<TimerHandle, { at: number; fn: () => void }>();
  now = 0;

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle = this.next++;
    this.timers.set(handle, { at: this.now + ms, fn });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle);
  }

  get pendingCount(): number {
    return this.timers.size;
  }

  /** Advances time, firing due timers in scheduled order. */
  tick(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [handle, timer] = due;
      this.timers.delete(handle);
      this.now = timer.at;
      timer.fn();
    }
    this.now = target;
  }
}

export class FakeRenderer implements RendererPort {
  renders: { pos: Position; lastMove: Square | null }[] = [];
  hints: readonly Square[] = [];
  inputEnabled = false;
  snaps = 0;
  private queue: { move: AnimatedMove; done: () => void }[] = [];

  render(pos: Position, lastMove: Square | null): void {
    this.renders.push({ pos, lastMove });
  }
  animateMove(move: AnimatedMove, done: () => void): void {
    this.queue.push({ move, done });
  }
  snapAnimationsToEnd(): void {
    this.snaps++;
    this.queue = [];
  }
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
  }
  setHints(squares: readonly Square[]): void {
    this.hints = squares;
  }

  get animating(): boolean {
    return this.queue.length > 0;
  }
  /** Completes every queued animation, as the real ticker eventually does. */
  finishAnimations(): void {
    const queued = this.queue;
    this.queue = [];
    for (const a of queued) a.done();
  }
}

export class FakeHud implements HudPort {
  phases: Phase[] = [];
  last: { pos: Position; phase: Phase; canUndo: boolean } | null = null;
  render(pos: Position, phase: Phase, canUndo: boolean): void {
    this.phases.push(phase);
    this.last = { pos, phase, canUndo };
  }
}

export class FakeAudio implements AudioPort {
  played: SoundName[] = [];
  calls: { sound: SoundName; flipped: number }[] = [];
  play(sound: SoundName, flipped = 0): void {
    this.played.push(sound);
    this.calls.push({ sound, flipped });
  }
}

export class FakeSearch implements SearchPort {
  requests: { board: Board; player: Player; level: Level }[] = [];
  aborts = 0;
  private onDone: ((move: Square) => void) | null = null;

  start(
    req: Readonly<{ board: Board; player: Player; level: Level }>,
    onDone: (move: Square) => void,
  ): void {
    this.requests.push({ ...req });
    this.onDone = onDone;
  }
  abort(): void {
    this.aborts++;
    // The callback is deliberately kept: a real worker reply can still be in
    // flight after an abort, and the machine's epoch guard must drop it.
  }

  get pending(): boolean {
    return this.onDone !== null;
  }
  get lastRequest() {
    return this.requests[this.requests.length - 1];
  }
  /** Delivers a reply for the most recent request. */
  respond(move: Square): void {
    this.onDone?.(move);
  }
  /** Delivers a reply and forgets the request, as a completed search does. */
  complete(move: Square): void {
    const cb = this.onDone;
    this.onDone = null;
    cb?.(move);
  }
}

export class FakeStorage implements StoragePort {
  saved: string | null = null;
  constructor(initial: string | null = null) {
    this.saved = initial;
  }
  save(json: string): void {
    this.saved = json;
  }
  load(): string | null {
    return this.saved;
  }
}
