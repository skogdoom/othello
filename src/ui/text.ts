import { BLACK, WHITE } from '../core/types.js';
import type { Position } from '../core/game.js';
import type { Player } from '../core/types.js';
import type { Phase } from '../ports.js';

export const PLAYER_NAME: Readonly<Record<Player, string>> = {
  [BLACK]: 'Black',
  [WHITE]: 'White',
};

/** "Black wins", "Draw" — only meaningful once the game is over. */
export function resultText(pos: Position): string {
  if (pos.status.kind !== 'over') return '';
  const { winner } = pos.status;
  return winner === null ? 'Draw' : `${PLAYER_NAME[winner]} wins`;
}

export function scoreText(pos: Position): string {
  return `${pos.score.black} – ${pos.score.white}`;
}

/** The single line of state the HUD shows. */
export function statusText(pos: Position, phase: Phase): string {
  if (phase.kind === 'passNotice') {
    return `${PLAYER_NAME[phase.by]} has no move — passing`;
  }
  if (pos.status.kind === 'over') return resultText(pos);
  if (phase.kind === 'humanTurn') return 'Your turn';
  return `${PLAYER_NAME[pos.status.player]} is thinking…`;
}
