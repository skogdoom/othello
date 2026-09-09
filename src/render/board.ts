import { Application, Container, Graphics, Rectangle } from 'pixi.js';
import { BLACK, EMPTY, colOf, rowOf } from '../core/types.js';
import { get } from '../core/board.js';
import { CELL, THEME } from './theme.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Position } from '../core/game.js';
import type { Square } from '../core/types.js';
import type { AnimatedMove, RendererPort } from '../ports.js';

const centre = (index: number): number => THEME.margin + index * CELL + CELL / 2;

/**
 * S1 renderer: a full redraw per position change, no animation. S2 replaces
 * `animateMove` with the flip cascade; nothing above this file changes.
 */
export class BoardRenderer implements RendererPort {
  private readonly grid = new Graphics();
  private readonly discs = new Graphics();
  private readonly hintLayer = new Graphics();
  private readonly ring = new Graphics();
  private readonly board = new Container();

  private position: Position | null = null;
  private hints: readonly Square[] = [];
  private lastMove: Square | null = null;
  private inputEnabled = false;

  constructor(
    private readonly app: Application,
    private readonly onTap: (square: Square) => void,
  ) {
    this.board.addChild(this.grid, this.discs, this.hintLayer, this.ring);
    this.board.eventMode = 'static';
    this.board.hitArea = new Rectangle(0, 0, THEME.boardSize, THEME.boardSize);
    this.board.on('pointertap', this.handleTap);
    this.app.stage.addChild(this.board);
    this.drawGrid();
  }

  private readonly handleTap = (event: FederatedPointerEvent): void => {
    if (!this.inputEnabled) return;
    const local = this.board.toLocal(event.global);
    const col = Math.floor((local.x - THEME.margin) / CELL);
    const row = Math.floor((local.y - THEME.margin) / CELL);
    if (col < 0 || col > 7 || row < 0 || row > 7) return;
    this.onTap(row * 8 + col);
  };

  private drawGrid(): void {
    const { boardSize, margin } = THEME;
    const inner = boardSize - margin * 2;
    this.grid
      .rect(0, 0, boardSize, boardSize)
      .fill(THEME.feltEdge)
      .rect(margin, margin, inner, inner)
      .fill(THEME.felt);

    for (let i = 0; i <= 8; i++) {
      const at = margin + i * CELL;
      this.grid.moveTo(margin, at).lineTo(margin + inner, at);
      this.grid.moveTo(at, margin).lineTo(at, margin + inner);
    }
    this.grid.stroke({ width: THEME.gridWidth, color: THEME.gridLine });
  }

  render(pos: Position, lastMove: Square | null): void {
    this.position = pos;
    this.lastMove = lastMove;
    this.redraw();
  }

  animateMove(_move: AnimatedMove, done: () => void): void {
    // S1 has no animation: the position is already drawn, so the resolving
    // phase is over as soon as it begins.
    done();
  }

  snapAnimationsToEnd(): void {
    // Nothing is in flight until S2.
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    this.board.cursor = enabled ? 'pointer' : 'default';
  }

  setHints(squares: readonly Square[]): void {
    this.hints = squares;
    this.redraw();
  }

  private redraw(): void {
    const pos = this.position;
    this.discs.clear();
    this.hintLayer.clear();
    this.ring.clear();
    if (!pos) return;

    const radius = CELL * THEME.discRadius;
    for (let s = 0; s < 64; s++) {
      const cell = get(pos.board, s);
      if (cell === EMPTY) continue;
      this.discs
        .circle(centre(colOf(s)), centre(rowOf(s)), radius)
        .fill(cell === BLACK ? THEME.black : THEME.white)
        .stroke({
          width: 1,
          color: THEME.discEdge,
          alpha: THEME.discEdgeAlpha,
        });
    }

    for (const s of this.hints) {
      this.hintLayer
        .circle(centre(colOf(s)), centre(rowOf(s)), CELL * THEME.hintRadius)
        .fill({ color: THEME.hint, alpha: THEME.hintAlpha });
    }

    if (this.lastMove !== null) {
      this.ring
        .circle(
          centre(colOf(this.lastMove)),
          centre(rowOf(this.lastMove)),
          CELL * THEME.ringRadius,
        )
        .stroke({ width: THEME.ringWidth, color: THEME.ring });
    }
  }
}
