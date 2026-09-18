import { positionAfter } from '../core/game.js';
import { rankMoves } from '../ai/debug.js';
import type { Game } from '../core/game.js';

/**
 * Dev-only tool behind the `?aiDebug` URL flag. Steps through the game's
 * move list and shows every legal move at that ply ranked by the current
 * level's evaluation function — for tuning `ai/eval.ts`'s weights without
 * playing full games by hand. Never imported unless the flag is present.
 */
export class DevStepper {
  private ply: number;
  private readonly root: HTMLElement;

  constructor(private readonly getGame: () => Game) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'z-index:1000',
      'max-height:80vh',
      'overflow:auto',
      'padding:8px 10px',
      'background:#0e1013e6',
      'color:#f4f2ec',
      'border:1px solid #3a3f45',
      'border-radius:8px',
      'font:12px/1.4 ui-monospace, monospace',
    ].join(';');
    document.body.appendChild(this.root);
    this.ply = 0;
    this.refresh();
  }

  /** Call after every machine phase entry, to follow new moves as they land. */
  refresh(): void {
    this.ply = this.getGame().moves.length;
    this.render();
  }

  private step(delta: number): void {
    const max = this.getGame().moves.length;
    this.ply = Math.max(0, Math.min(max, this.ply + delta));
    this.render();
  }

  private render(): void {
    const game = this.getGame();
    const pos = positionAfter(game, this.ply);

    const rows =
      pos.status.kind === 'turn'
        ? rankMoves(pos.board, pos.status.player, game.difficulty)
            .map((m) => `<li>${m.square}: ${m.score.toFixed(1)}</li>`)
            .join('')
        : '<li>game over</li>';

    this.root.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <button type="button" data-dir="-1" ${this.ply <= 0 ? 'disabled' : ''}>&#9664;</button>
        <span>ply ${this.ply} / ${game.moves.length} (${game.difficulty})</span>
        <button type="button" data-dir="1" ${this.ply >= game.moves.length ? 'disabled' : ''}>&#9654;</button>
      </div>
      <ol style="margin:0;padding-left:1.4em">${rows}</ol>
    `;
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('button[data-dir]')) {
      btn.addEventListener('click', () => this.step(Number(btn.dataset['dir'])));
    }
  }
}
