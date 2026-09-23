import type { AudioPort, SoundName } from '../ports.js';

const SOUNDS: readonly SoundName[] = ['place', 'flip', 'invalid', 'end'];

/**
 * Where a real clip would live. Dropping files in needs no code change.
 * Relative to the page, not the domain root, so the game can be hosted from a
 * subdirectory.
 */
const url = (name: SoundName): string => `sounds/${name}.mp3`;

const MUTE_KEY = 'othello.mute';

type Ctor = new () => AudioContext;

function audioContextCtor(): Ctor | null {
  const w = globalThis as unknown as {
    AudioContext?: Ctor;
    webkitAudioContext?: Ctor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    globalThis.localStorage?.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // A private-mode localStorage that throws is not worth a broken game.
  }
}

/**
 * How loud and how deep a flip sounds, from the number of discs it turned.
 * A big capture is louder and pitched down: larger things sound larger.
 */
function flipShape(flipped: number): { gain: number; rate: number } {
  const weight = Math.min(Math.max(flipped, 1), 10) / 10;
  return { gain: 0.22 + weight * 0.4, rate: 1.12 - weight * 0.32 };
}

/**
 * WebAudio with decoded buffers, and a synthesized placeholder for every clip
 * that is missing. The game has to run with no sound files present at all —
 * including with no WebAudio — so every path here degrades to silence rather
 * than throwing, and each sound resolves independently: a missing end.mp3
 * must not cost a present place.mp3.
 */
export class WebAudioPlayer implements AudioPort {
  private readonly context: AudioContext | null;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private muted = readMuted();

  constructor() {
    const Ctor = audioContextCtor();
    if (!Ctor) {
      console.debug('[audio] no WebAudio in this browser: the game runs silent');
      this.context = null;
      return;
    }
    try {
      this.context = new Ctor();
    } catch {
      console.debug('[audio] the audio context could not be created: running silent');
      this.context = null;
    }
  }

  /** Fetches and decodes every clip up front; failures become placeholders. */
  async load(): Promise<void> {
    const ctx = this.context;
    if (!ctx) return;

    await Promise.all(
      SOUNDS.map(async (name) => {
        try {
          const response = await fetch(url(name));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          this.buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
        } catch {
          console.debug(`[audio] ${name}: using the synthesized placeholder`);
        }
      }),
    );
  }

  /** iOS only starts the context inside a user gesture. */
  unlock(): void {
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    writeMuted(muted);
  }

  /** `flipped` is the number of discs turned, and shapes the flip sound. */
  play(sound: SoundName, flipped = 0): void {
    const ctx = this.context;
    if (!ctx || this.muted) return;
    this.unlock();

    try {
      const buffer = this.buffers.get(sound);
      if (buffer) this.playBuffer(ctx, buffer, sound, flipped);
      else this.playPlaceholder(ctx, sound, flipped);
    } catch {
      // A sound is never worth interrupting the game for.
    }
  }

  private playBuffer(
    ctx: AudioContext,
    buffer: AudioBuffer,
    sound: SoundName,
    flipped: number,
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.7;

    if (sound === 'flip') {
      const shape = flipShape(flipped);
      source.playbackRate.value = shape.rate;
      gain.gain.value = shape.gain + 0.2;
    }

    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  /** One oscillator and one gain ramp: enough to place, flip, buzz and end. */
  private tone(
    ctx: AudioContext,
    spec: {
      type: OscillatorType;
      frequency: number;
      to?: number;
      duration: number;
      gain: number;
      at?: number;
    },
  ): void {
    const start = ctx.currentTime + (spec.at ?? 0);
    const end = start + spec.duration;

    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.frequency, start);
    if (spec.to !== undefined) osc.frequency.exponentialRampToValueAtTime(spec.to, end);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(spec.gain, start + Math.min(0.012, spec.duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  private playPlaceholder(ctx: AudioContext, sound: SoundName, flipped: number): void {
    switch (sound) {
      case 'place': // low click
        this.tone(ctx, { type: 'triangle', frequency: 200, to: 120, duration: 0.09, gain: 0.5 });
        return;
      case 'flip': {
        // soft blip, deeper and louder the more discs turned
        const shape = flipShape(flipped);
        this.tone(ctx, {
          type: 'sine',
          frequency: 520 * shape.rate,
          to: 380 * shape.rate,
          duration: 0.07,
          gain: shape.gain,
        });
        return;
      }
      case 'invalid': // dull thud
        this.tone(ctx, { type: 'sawtooth', frequency: 96, to: 62, duration: 0.16, gain: 0.32 });
        return;
      case 'end': // two-note rising figure
        this.tone(ctx, { type: 'sine', frequency: 440, duration: 0.16, gain: 0.34 });
        this.tone(ctx, { type: 'sine', frequency: 660, duration: 0.22, gain: 0.34, at: 0.17 });
        return;
    }
  }
}
