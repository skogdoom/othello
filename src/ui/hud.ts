import { BLACK, WHITE } from '../core/types.js';
import type { Position } from '../core/game.js';
import type { HudPort, Phase } from '../ports.js';

const NAME = { [BLACK]: 'Black', [WHITE]: 'White' } as const;

function statusText(pos: Position, phase: Phase): string {
  if (phase.kind === 'passNotice') return `${NAME[phase.by]} has no move — passing`;
  if (pos.status.kind === 'over') {
    const { winner } = pos.status;
    return winner === null ? 'Draw' : `${NAME[winner]} wins`;
  }
  if (phase.kind === 'humanTurn') return 'Your turn';
  return `${NAME[pos.status.player]} is thinking…`;
}

/**
 * S1 HUD: score, whose turn it is, and restart. Undo (S5) and the difficulty
 * selector (S4) plug into the same render call.
 */
export class Hud implements HudPort {
  private readonly blackScore: HTMLElement;
  private readonly whiteScore: HTMLElement;
  private readonly status: HTMLElement;

  constructor(root: HTMLElement, onRestart: () => void) {
    root.innerHTML = `
      <div class="scores">
        <div class="score" id="score-black"><span class="disc black"></span><b>2</b></div>
        <div class="score" id="score-white"><span class="disc white"></span><b>2</b></div>
      </div>
      <p class="status" id="status">Your turn</p>
      <button type="button" id="restart">Restart</button>
    `;
    this.blackScore = root.querySelector('#score-black b')!;
    this.whiteScore = root.querySelector('#score-white b')!;
    this.status = root.querySelector('#status')!;
    root.querySelector('#restart')!.addEventListener('click', onRestart);
  }

  render(pos: Position, phase: Phase, _canUndo: boolean): void {
    this.blackScore.textContent = String(pos.score.black);
    this.whiteScore.textContent = String(pos.score.white);
    this.status.textContent = statusText(pos, phase);
  }
}
