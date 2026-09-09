import type { AudioPort, SoundName } from '../ports.js';

/**
 * S1 has no sound. S2 replaces this with the WebAudio implementation —
 * decoded buffers, synthesized fallbacks and a mute toggle — behind the same
 * port, so nothing that calls `play` changes.
 */
export class SilentAudio implements AudioPort {
  play(_sound: SoundName): void {}
}
