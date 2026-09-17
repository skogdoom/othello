import { resultText, scoreText } from './text.js';
import type { Position } from '../core/game.js';
import type { HudPort, Phase } from '../ports.js';

/**
 * The game-over panel. It covers the stage only, never the HUD, and it is
 * dismissible so the player can look at the final board.
 */
export class GameOverOverlay implements HudPort {
  private readonly heading: HTMLElement;
  private readonly score: HTMLElement;
  private dismissed = false;

  constructor(private readonly root: HTMLElement, onPlayAgain: () => void) {
    root.classList.add('overlay');
    root.hidden = true;
    root.innerHTML = `
      <div class="overlay-panel" role="dialog" aria-live="polite">
        <h2 id="overlay-result">Game over</h2>
        <p id="overlay-score">0 – 0</p>
        <div class="overlay-actions">
          <button type="button" id="play-again">Play again</button>
          <button type="button" id="view-board">View board</button>
        </div>
      </div>
    `;
    this.heading = root.querySelector('#overlay-result')!;
    this.score = root.querySelector('#overlay-score')!;

    root.querySelector('#play-again')!.addEventListener('click', onPlayAgain);
    root.querySelector('#view-board')!.addEventListener('click', () => this.dismiss());
    root.addEventListener('pointerdown', (event) => {
      if (event.target === root) this.dismiss(); // a tap on the backdrop
    });
  }

  private dismiss(): void {
    this.dismissed = true;
    this.root.hidden = true;
  }

  render(pos: Position, phase: Phase, _canUndo: boolean): void {
    if (phase.kind !== 'gameOver') {
      this.dismissed = false;
      this.root.hidden = true;
      return;
    }
    this.heading.textContent = resultText(pos);
    this.score.textContent = scoreText(pos);
    this.root.hidden = this.dismissed;
  }
}
