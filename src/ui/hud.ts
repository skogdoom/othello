import { LEVELS } from '../ai/levels.js';
import { LEVEL_NAME, statusText } from './text.js';
import type { Level } from '../ai/levels.js';
import type { Position } from '../core/game.js';
import type { HudPort, Phase } from '../ports.js';

export type HudActions = Readonly<{
  onRestart: () => void;
  onToggleMute: () => void;
  isMuted: () => boolean;
  onSetDifficulty: (level: Level) => void;
  getDifficulty: () => Level;
  onUndo: () => void;
}>;

/**
 * Score, whose turn it is, difficulty, undo, restart and mute. One markup
 * tree for both layouts: a bottom bar in portrait, a sidebar in landscape,
 * decided in CSS.
 */
export class Hud implements HudPort {
  private readonly blackScore: HTMLElement;
  private readonly whiteScore: HTMLElement;
  private readonly status: HTMLElement;
  private readonly difficulty: HTMLSelectElement;
  private readonly undo: HTMLButtonElement;
  private readonly mute: HTMLButtonElement;

  constructor(root: HTMLElement, private readonly actions: HudActions) {
    const options = LEVELS.map((l) => `<option value="${l}">${LEVEL_NAME[l]}</option>`).join('');
    root.innerHTML = `
      <div class="scores">
        <div class="score" id="score-black"><span class="disc black"></span><b>2</b></div>
        <div class="score" id="score-white"><span class="disc white"></span><b>2</b></div>
      </div>
      <p class="status" id="status">Your turn</p>
      <div class="controls">
        <select id="difficulty" aria-label="Difficulty">${options}</select>
        <button type="button" id="undo">Undo</button>
        <button type="button" id="mute" aria-pressed="false">Sound on</button>
        <button type="button" id="restart">Restart</button>
      </div>
    `;
    this.blackScore = root.querySelector('#score-black b')!;
    this.whiteScore = root.querySelector('#score-white b')!;
    this.status = root.querySelector('#status')!;
    this.difficulty = root.querySelector('#difficulty')!;
    this.undo = root.querySelector('#undo')!;
    this.mute = root.querySelector('#mute')!;

    root.querySelector('#restart')!.addEventListener('click', actions.onRestart);
    this.undo.addEventListener('click', actions.onUndo);
    this.mute.addEventListener('click', () => {
      actions.onToggleMute();
      this.drawMute();
    });
    this.difficulty.addEventListener('change', () => {
      actions.onSetDifficulty(this.difficulty.value as Level);
    });
    this.drawMute();
    this.drawDifficulty();
  }

  private drawMute(): void {
    const muted = this.actions.isMuted();
    this.mute.textContent = muted ? 'Sound off' : 'Sound on';
    this.mute.setAttribute('aria-pressed', String(muted));
  }

  private drawDifficulty(): void {
    this.difficulty.value = this.actions.getDifficulty();
  }

  render(pos: Position, phase: Phase, canUndo: boolean): void {
    this.blackScore.textContent = String(pos.score.black);
    this.whiteScore.textContent = String(pos.score.white);
    this.status.textContent = statusText(pos, phase);
    this.undo.disabled = !canUndo;
    this.drawMute();
    this.drawDifficulty();
  }
}
