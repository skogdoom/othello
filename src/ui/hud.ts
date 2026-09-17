import { statusText } from './text.js';
import type { Position } from '../core/game.js';
import type { HudPort, Phase } from '../ports.js';

export type HudActions = Readonly<{
  onRestart: () => void;
  onToggleMute: () => void;
  isMuted: () => boolean;
}>;

/**
 * Score, whose turn it is, restart and mute. One markup tree for both
 * layouts: a bottom bar in portrait, a sidebar in landscape, decided in CSS.
 * Undo (S5) and the difficulty selector (S4) go in `.controls` alongside the
 * buttons that are already there.
 */
export class Hud implements HudPort {
  private readonly blackScore: HTMLElement;
  private readonly whiteScore: HTMLElement;
  private readonly status: HTMLElement;
  private readonly mute: HTMLButtonElement;

  constructor(root: HTMLElement, private readonly actions: HudActions) {
    root.innerHTML = `
      <div class="scores">
        <div class="score" id="score-black"><span class="disc black"></span><b>2</b></div>
        <div class="score" id="score-white"><span class="disc white"></span><b>2</b></div>
      </div>
      <p class="status" id="status">Your turn</p>
      <div class="controls">
        <button type="button" id="mute" aria-pressed="false">Sound on</button>
        <button type="button" id="restart">Restart</button>
      </div>
    `;
    this.blackScore = root.querySelector('#score-black b')!;
    this.whiteScore = root.querySelector('#score-white b')!;
    this.status = root.querySelector('#status')!;
    this.mute = root.querySelector('#mute')!;

    root.querySelector('#restart')!.addEventListener('click', actions.onRestart);
    this.mute.addEventListener('click', () => {
      actions.onToggleMute();
      this.drawMute();
    });
    this.drawMute();
  }

  private drawMute(): void {
    const muted = this.actions.isMuted();
    this.mute.textContent = muted ? 'Sound off' : 'Sound on';
    this.mute.setAttribute('aria-pressed', String(muted));
  }

  render(pos: Position, phase: Phase, _canUndo: boolean): void {
    this.blackScore.textContent = String(pos.score.black);
    this.whiteScore.textContent = String(pos.score.white);
    this.status.textContent = statusText(pos, phase);
    this.drawMute();
  }
}
