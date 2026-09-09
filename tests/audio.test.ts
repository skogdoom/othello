import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebAudioPlayer } from '../src/audio/index.js';
import { createMachine } from '../src/machine.js';
import { currentPosition } from '../src/core/game.js';
import { MIN_AI_DELAY_MS, PASS_NOTICE_MS } from '../src/machine.js';
import { BLACK } from '../src/core/types.js';
import { FakeClock, FakeHud, FakeRenderer, FakeSearch, FakeStorage } from './fakes.js';

/** Just enough WebAudio to see what the player asks for. */
class FakeParam {
  value = 0;
  events: { kind: string; value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number): this {
    this.events.push({ kind: 'set', value, at });
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number): this {
    this.events.push({ kind: 'ramp', value, at });
    return this;
  }
  get peak(): number {
    return Math.max(...this.events.map((e) => e.value), 0);
  }
}

class FakeNode {
  connect<T>(target: T): T {
    return target;
  }
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  started = false;
  start(): void {
    this.started = true;
  }
  stop(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  state: 'running' | 'suspended' = 'running';
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  resumed = 0;

  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource(): FakeNode {
    return new FakeNode();
  }
  async decodeAudioData(): Promise<never> {
    throw new Error('not a real clip');
  }
  async resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
  }
}

const withAudioContext = () => {
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  // No sound files present: every fetch 404s.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
};

const latest = (): FakeAudioContext =>
  FakeAudioContext.instances[FakeAudioContext.instances.length - 1]!;

describe('audio', () => {
  let debug: ReturnType<typeof vi.spyOn>;

  /** The debug lines logged so far, one per fallback. */
  const debugLines = (): string[] =>
    (debug.mock.calls as unknown[][]).map((call) => String(call[0]));

  beforeEach(() => {
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs silent when the browser has no WebAudio', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);

    const audio = new WebAudioPlayer();
    await audio.load();
    audio.unlock();
    for (const sound of ['place', 'flip', 'invalid', 'end'] as const) audio.play(sound, 5);

    expect(debug).toHaveBeenCalledWith(expect.stringContaining('no WebAudio'));
  });

  it('falls back to a placeholder per missing clip, once each', async () => {
    withAudioContext();
    const audio = new WebAudioPlayer();
    await audio.load();

    const lines = debugLines();
    for (const sound of ['place', 'flip', 'invalid', 'end']) {
      expect(lines.filter((l) => l.includes(`${sound}:`)).length).toBe(1);
    }
  });

  it('keeps a present clip when another one is missing', async () => {
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        String(input).includes('place.mp3')
          ? new Response(new ArrayBuffer(8), { status: 200 })
          : new Response(null, { status: 404 }),
      ),
    );
    const decoded = {} as AudioBuffer;
    vi.spyOn(FakeAudioContext.prototype, 'decodeAudioData').mockResolvedValue(
      decoded as never,
    );

    const audio = new WebAudioPlayer();
    await audio.load();

    const lines = debugLines();
    expect(lines.some((line) => line.includes('place:'))).toBe(false);
    expect(lines.filter((line) => line.includes('using the synthesized placeholder')).length).toBe(3);
  });

  it('plays a placeholder for each sound, and shapes the flip by disc count', async () => {
    withAudioContext();
    const audio = new WebAudioPlayer();
    await audio.load();
    const ctx = latest();

    audio.play('place');
    expect(ctx.oscillators.length).toBe(1);
    audio.play('end');
    expect(ctx.oscillators.length).toBe(3); // a two-note figure

    audio.play('flip', 1);
    const small = ctx.gains[ctx.gains.length - 1]!.gain.peak;
    const smallPitch = ctx.oscillators[ctx.oscillators.length - 1]!.frequency.events[0]!.value;

    audio.play('flip', 12);
    const large = ctx.gains[ctx.gains.length - 1]!.gain.peak;
    const largePitch = ctx.oscillators[ctx.oscillators.length - 1]!.frequency.events[0]!.value;

    // A large capture sounds larger: louder, and pitched down.
    expect(large).toBeGreaterThan(small);
    expect(largePitch).toBeLessThan(smallPitch);
  });

  it('makes no sound while muted, and remembers the setting', async () => {
    withAudioContext();
    const audio = new WebAudioPlayer();
    await audio.load();

    audio.setMuted(true);
    audio.play('place');
    audio.play('flip', 4);
    expect(latest().oscillators.length).toBe(0);

    expect(new WebAudioPlayer().isMuted()).toBe(true);
    audio.setMuted(false);
    expect(new WebAudioPlayer().isMuted()).toBe(false);
  });

  it('resumes a suspended context on the first gesture', async () => {
    withAudioContext();
    const audio = new WebAudioPlayer();
    await audio.load();
    const ctx = latest();
    ctx.state = 'suspended';

    audio.unlock();
    expect(ctx.resumed).toBe(1);
  });

  it('boots, plays a full game and ends cleanly with every sound file absent', async () => {
    withAudioContext();
    const audio = new WebAudioPlayer();
    await audio.load();

    const renderer = new FakeRenderer();
    const search = new FakeSearch();
    const clock = new FakeClock();
    const machine = createMachine({
      renderer,
      hud: new FakeHud(),
      audio,
      search,
      clock,
      storage: new FakeStorage(),
      humanColor: BLACK,
      difficulty: 'easy',
    });

    machine.start();
    let guard = 0;
    while (machine.getPhase().kind !== 'gameOver') {
      if (machine.getPhase().kind === 'humanTurn') {
        machine.tap(currentPosition(machine.getGame()).legal[0]!);
      }
      if (search.pending) search.complete(currentPosition(machine.getGame()).legal[0]!);
      clock.tick(MIN_AI_DELAY_MS + PASS_NOTICE_MS);
      renderer.finishAnimations();
      expect(++guard).toBeLessThan(200);
    }

    expect(currentPosition(machine.getGame()).status.kind).toBe('over');
    expect(latest().oscillators.length).toBeGreaterThan(10);
    expect(debugLines().every((line) => line.startsWith('[audio]'))).toBe(true);
  });
});
