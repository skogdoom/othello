import { Container, Graphics, Rectangle, UPDATE_PRIORITY } from 'pixi.js';
import { BLACK, EMPTY, colOf, opponent, rowOf } from '../core/types.js';
import { get } from '../core/board.js';
import { CELL, THEME } from './theme.js';
import { fitBoard } from './layout.js';
import { TIMING } from './timing.js';
import { Tweens, easeInOutQuad } from './tween.js';
import type { Application, FederatedPointerEvent } from 'pixi.js';
import type { Position } from '../core/game.js';
import type { Cell, Square } from '../core/types.js';
import type { AnimatedMove, RendererPort } from '../ports.js';

const centre = (index: number): number => THEME.margin + index * CELL + CELL / 2;

const chebyshev = (a: Square, b: Square): number =>
  Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)));

/** Overshoots slightly at the end, so a placed disc lands rather than arrives. */
const easeOutBack = (t: number): number => {
  const c = 1.2;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

export class BoardRenderer implements RendererPort {
  private readonly grid = new Graphics();
  private readonly discLayer = new Container();
  private readonly hintLayer = new Graphics();
  private readonly ring = new Graphics();
  private readonly board = new Container();
  private readonly tweens: Tweens;

  /** One Graphics per occupied square, so flips can be scaled individually. */
  private readonly discs: (Graphics | null)[] = new Array(64).fill(null);
  private readonly colours: Cell[] = new Array(64).fill(EMPTY);

  private width = 0;
  private height = 0;
  private hints: readonly Square[] = [];
  private lastMove: Square | null = null;
  private inputEnabled = false;

  /** Something on the board changed since the last frame was drawn. */
  private dirty = false;
  private framesDrawn = 0;

  constructor(
    private readonly app: Application,
    private readonly onTap: (square: Square) => void,
  ) {
    this.tweens = new Tweens(app.ticker, () => this.invalidate());
    this.board.addChild(this.grid, this.discLayer, this.hintLayer, this.ring);
    this.board.eventMode = 'static';
    this.board.hitArea = new Rectangle(0, 0, THEME.boardSize, THEME.boardSize);
    this.board.on('pointertap', this.handleTap);
    this.app.stage.addChild(this.board);

    // Draw on demand rather than on every tick: a static board needs no frames
    // at all, and on a phone the default loop keeps the GPU busy for nothing.
    // The ticker still steps the tweens, and stops once there is nothing left
    // to draw. This runs after the tweens in each tick, so it draws their step.
    app.ticker.remove(app.render, app);
    app.ticker.add(this.frame, undefined, UPDATE_PRIORITY.LOW);
    // A restored WebGL context comes back blank, and a page coming back from
    // the background may have lost its canvas; nothing else would redraw them.
    const canvas = app.canvas as HTMLCanvasElement;
    canvas.addEventListener('webglcontextrestored', () => this.invalidate());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.invalidate();
    });

    this.drawGrid();
    this.invalidate();
  }

  /** Frames drawn since boot, for `?perf`: an idle board does not add to it. */
  get frameCount(): number {
    return this.framesDrawn;
  }

  /** Marks the board as needing a frame, and makes sure one comes. */
  private invalidate(): void {
    this.dirty = true;
    this.app.ticker.start(); // a no-op while it is already running
  }

  private readonly frame = (): void => {
    if (this.dirty) this.draw();
    // Nothing to draw and nothing animating: stop asking for frames.
    else if (!this.tweens.busy) this.app.ticker.stop();
  };

  private draw(): void {
    this.dirty = false;
    this.app.render();
    this.framesDrawn++;
  }

  /**
   * Sizes the renderer to the box the stage element actually has and scales
   * the board to fit it. Coordinates everywhere else stay in board units;
   * `toLocal` in the tap handler undoes this scale for free.
   */
  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;

    this.app.renderer.resize(w, h);
    const fit = fitBoard(w, h);
    this.board.scale.set(fit.scale);
    this.board.position.set(fit.x, fit.y);
    // Resizing clears the canvas. Draw now, before the browser paints it
    // blank, rather than on the next tick.
    this.draw();
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

  private paint(square: Square, cell: Cell): void {
    const disc = this.discs[square];
    if (!disc || cell === EMPTY) return;
    this.colours[square] = cell;
    disc
      .clear()
      .circle(0, 0, CELL * THEME.discRadius)
      .fill(cell === BLACK ? THEME.black : THEME.white)
      .stroke({ width: 1, color: THEME.discEdge, alpha: THEME.discEdgeAlpha });
  }

  private addDisc(square: Square, cell: Cell): Graphics {
    const disc = new Graphics();
    disc.position.set(centre(colOf(square)), centre(rowOf(square)));
    this.discLayer.addChild(disc);
    this.discs[square] = disc;
    this.paint(square, cell);
    return disc;
  }

  private removeDisc(square: Square): void {
    const disc = this.discs[square];
    if (!disc) return;
    this.discLayer.removeChild(disc);
    disc.destroy();
    this.discs[square] = null;
    this.colours[square] = EMPTY;
  }

  /** Brings the disc views in line with the position. */
  render(pos: Position, lastMove: Square | null): void {
    this.lastMove = lastMove;
    // A redraw can land mid-move: `enter` renders the new position and only
    // then starts its animation, and a difficulty change redraws while the
    // AI's flip is still running. Leave the scale to whichever tween owns it
    // — every tween ends at 1, snapped or not — and only reconcile colours.
    const animating = this.tweens.busy;

    for (let s = 0; s < 64; s++) {
      const cell = get(pos.board, s);
      if (cell === EMPTY) {
        this.removeDisc(s);
        continue;
      }
      const disc = this.discs[s] ?? this.addDisc(s, cell);
      if (!animating) disc.scale.set(1);
      if (this.colours[s] !== cell) this.paint(s, cell);
    }
    this.drawHints();
    this.drawRing();
    this.invalidate();
  }

  /**
   * `render` has already drawn the position this move produced, so the
   * animation rewinds the squares it touched and plays them forward: the
   * placed disc from nothing, the flipped discs from the opponent's colour.
   */
  animateMove(move: AnimatedMove, done: () => void): void {
    const { player, placed, flipped } = move;
    const was = opponent(player);

    let outstanding = 1 + flipped.length;
    const settleOne = (): void => {
      if (--outstanding === 0) done();
    };

    const placedDisc = this.discs[placed] ?? this.addDisc(placed, player);
    placedDisc.scale.set(0);
    this.tweens.add({
      duration: TIMING.PLACE_MS,
      onUpdate: (t) => placedDisc.scale.set(easeOutBack(t)),
      onComplete: settleOne,
    });

    for (const square of flipped) {
      const disc = this.discs[square];
      if (!disc) {
        settleOne();
        continue;
      }
      this.paint(square, was);
      disc.scale.set(1);

      this.tweens.add({
        duration: TIMING.FLIP_MS,
        delay: TIMING.FLIP_DELAY + chebyshev(placed, square) * TIMING.FLIP_CASCADE_STEP,
        onUpdate: (t) => {
          const eased = easeInOutQuad(t);
          // Squash to nothing at the halfway point and swap colour there.
          disc.scale.x = Math.abs(1 - 2 * eased);
          const wanted = eased < 0.5 ? was : player;
          if (this.colours[square] !== wanted) this.paint(square, wanted);
        },
        onComplete: settleOne,
      });
    }
  }

  snapAnimationsToEnd(): void {
    this.tweens.finishAll();
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    this.board.cursor = enabled ? 'pointer' : 'default';
  }

  setHints(squares: readonly Square[]): void {
    this.hints = squares;
    this.drawHints();
    this.invalidate();
  }

  private drawHints(): void {
    this.hintLayer.clear();
    for (const s of this.hints) {
      this.hintLayer
        .circle(centre(colOf(s)), centre(rowOf(s)), CELL * THEME.hintRadius)
        .fill({ color: THEME.hint, alpha: THEME.hintAlpha });
    }
  }

  private drawRing(): void {
    this.ring.clear();
    if (this.lastMove === null) return;
    this.ring
      .circle(
        centre(colOf(this.lastMove)),
        centre(rowOf(this.lastMove)),
        CELL * THEME.ringRadius,
      )
      .stroke({ width: THEME.ringWidth, color: THEME.ring });
  }
}
