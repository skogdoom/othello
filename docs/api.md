# Core API and state machine

Settled specification. Implement as written rather than proposing
alternatives. If something here turns out to be wrong once you are in the
code, say so and explain why before deviating.

---

# Core API

Four modules, all pure and synchronous. Functions over opaque types, not
classes or interfaces with methods: an interface adds polymorphic dispatch to
the hottest loop in the program for no benefit, and a module boundary gives
the same swappability at zero cost. If bitboards happen later, `board.ts` and
`rules.ts` change internally and nothing above them notices.

## `core/types.ts`

```ts
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Player = typeof BLACK | typeof WHITE;
export type Cell = typeof EMPTY | Player;

export const opponent = (p: Player): Player => (3 - p) as Player;

/** 0..63, row-major: index = row * 8 + col */
export type Square = number;

export const PASS = -1;
export type Move = Square | typeof PASS;
```

Numeric players with `3 - p` keep the AI's inner loop fast and serialize to
JSON without a mapping layer. Do not use `const enum` — esbuild, which Vite
uses, rejects it under `isolatedModules`.

## `core/board.ts`

```ts
export type Board = Readonly<{ cells: Int8Array }>;

export function initialBoard(): Board;
export function get(b: Board, s: Square): Cell;
export function count(b: Board, p: Player): number;
export function emptyCount(b: Board): number;
```

## `core/rules.ts`

```ts
export function legalMoves(b: Board, p: Player): Square[];
export function isLegal(b: Board, p: Player, s: Square): boolean;

export type MoveResult = Readonly<{
  board: Board;
  placed: Square;
  flipped: readonly Square[];
}>;

export function applyMove(b: Board, p: Player, s: Square): MoveResult;
```

`applyMove` returns the flipped squares because the renderer needs them and
recomputing would duplicate the ray-scan logic. Return them flat, not grouped
by direction: Chebyshev distance from `placed` equals the index along its ray,
so the renderer derives the cascade delay itself with one subtraction.

`applyMove` throws `IllegalMoveError` on an illegal square. That is a
programming error, not a user input case — the UI only ever offers squares
returned by `legalMoves`.

## `core/game.ts`

```ts
export type Game = Readonly<{
  moves: readonly Move[];
  humanColor: Player;
  difficulty: Level;
}>;

export type Status =
  | Readonly<{ kind: 'turn'; player: Player }>
  | Readonly<{ kind: 'over'; winner: Player | null }>;

export type Position = Readonly<{
  board: Board;
  status: Status;
  legal: readonly Square[];
  score: Readonly<{ black: number; white: number }>;
}>;

export function newGame(humanColor: Player, difficulty: Level): Game;

export function currentPosition(g: Game): Position;
export function positionAfter(g: Game, plies: number): Position;

export function play(g: Game, s: Square): Game;
export function undo(g: Game): Game;
export function canUndo(g: Game): boolean;

export function serialize(g: Game): string;
export function deserialize(json: string): Game | null;
```

There is deliberately no `cursor` field. `positionAfter(g, n)` gives a future
replay feature everything it needs without carrying state that is always equal
to `moves.length` in v1.

**`play` auto-appends passes.** After applying the move it appends `PASS`
entries while the side to move has no legal move and the game is not over.
This guarantees `currentPosition().status` is either `over` or a turn for a
player who genuinely has a move, so no caller ever handles "your turn but you
can't do anything". The UI still has to *show* that a pass happened — derive
it from the diff between the old and new move lists, not from the position.

**`undo` pops back to the last position where the human had a legal move** —
pop while a last move exists and it is not the human's turn. Not a fixed two
plies, since passes intervene. Unlimited depth, back to the opening.

**Memoize `currentPosition`** with a module-level `WeakMap<Game, Position>`.
The renderer and HUD both call it constantly, and `Game` is immutable so the
cache can never go stale.

**`deserialize` returns `null` rather than throwing.** Corrupt or outdated
`localStorage` is an expected condition and the caller's response is always to
start a new game.

## `ai/index.ts`

```ts
export type Level = 'easy' | 'medium' | 'hard';

export function findMove(
  b: Board,
  p: Player,
  level: Level,
  signal?: AbortSignal,
): Square;
```

`Int8Array` is structured-cloneable, so the worker message is
`{ cells, player, level }` with no serialization layer. The `AbortSignal`
exists for undo and restart landing mid-search; check it once per
iterative-deepening iteration, not per node.

---

# State machine

The machine owns presentation state only. `Game` stays the single source of
truth for the position; the machine decides what the screen may do and when
the next move gets applied.

```ts
type Phase =
  | { kind: 'boot' }
  | { kind: 'humanTurn' }          // the only state where input is enabled
  | { kind: 'humanMoveResolving' } // animating; AI search runs in parallel
  | { kind: 'aiMoveResolving' }    // animating the AI's reply
  | { kind: 'passNotice'; by: Player; next: 'human' | 'ai' }
  | { kind: 'gameOver' };
```

There is deliberately **no `aiThinking` state**. Waiting for the search is not
a phase; it is one of several things that must finish before the AI's move can
land. Modelling it as a state forces you to enumerate every interleaving of
"animation finished first" versus "search finished first".

## The barrier

Both resolving states are joins over a set of outstanding tokens:

```ts
type Token = 'anim' | 'search' | 'minDelay';

let pending = new Set<Token>();
let searchResult: Square | null = null;

function settle(t: Token) {
  pending.delete(t);
  if (pending.size === 0) advance();
}
```

`humanMoveResolving` waits on all three, started concurrently the moment the
human's move is applied; whichever finishes last calls `advance()`. This is
where the parallelism comes from: on Hard, an 800 ms search overlaps a 300 ms
animation, so the reply lands ~800 ms after the tap rather than ~1100.

`aiMoveResolving` waits on `anim` only.

`minDelay` is measured from the human's tap, not from when the search returns,
or Easy adds 400 ms of dead air on top of an already-finished search.

## Epoch guard

Every async completion carries the epoch it was issued under. Undo, restart
and difficulty changes bump it.

```ts
let epoch = 0;

function invalidate() {
  epoch++;
  abortController.abort();
  pending.clear();
  searchResult = null;
  renderer.snapAnimationsToEnd();
}

function onSearchDone(move: Square, e: number) {
  if (e !== epoch) return;   // stale worker reply after an undo
  searchResult = move;
  settle('search');
}
```

Without this, an undo during a search produces the bug where the discarded
move lands a second later on a board it does not belong to. Every callback
into the machine — worker message, animation completion, timer — needs the
same check.

Snap animations to their end state rather than cancelling them: an interrupted
flip must not leave a disc frozen at `scale.x = 0`. The renderer then does a
full redraw from the new position.

## After a move lands

```ts
function advance() {
  const before = game;
  game = play(game, chosenSquare);

  const passes = trailingPasses(before, game);   // 0, 1, or 2
  const pos = currentPosition(game);

  if (pos.status.kind === 'over') return enter({ kind: 'gameOver' });

  if (passes > 0) {
    return enter({
      kind: 'passNotice',
      by: opponent(mover),
      next: pos.status.player === game.humanColor ? 'human' : 'ai',
    });
  }

  return pos.status.player === game.humanColor
    ? enter({ kind: 'humanTurn' })
    : startAiTurn();
}
```

Because `play` auto-appends passes, the machine never sees a turn belonging to
a player with no legal moves; it only notices that passes occurred so it can
say so. `passNotice` holds ~900 ms then routes onward. A double pass is a game
end, not a notice — the `over` check catches it first.

## Event table

| Event | `humanTurn` | `humanMoveResolving` | `aiMoveResolving` | `passNotice` | `gameOver` |
|---|---|---|---|---|---|
| Tap on legal square | apply, start all three tokens | ignore | ignore | ignore | ignore |
| Tap on occupied square | `invalid` sound | ignore | ignore | ignore | ignore |
| Tap on empty non-legal square | silent | ignore | ignore | ignore | ignore |
| `SEARCH_DONE` | — | `settle('search')` | — | — | — |
| `ANIM_DONE` | — | `settle('anim')` | `settle('anim')` | — | — |
| `DELAY_DONE` | — | `settle('minDelay')` | — | — | — |
| Undo | invalidate, pop, → `humanTurn` | same | same | same | same |
| Restart | invalidate, new game | same | same | same | same |
| Difficulty change | apply | invalidate, restart AI turn | apply | apply | apply |

Undo is allowed in every state except `boot` — simpler than disabling it
mid-animation, and safe now that `invalidate` exists. The button still
visually disables when `canUndo(game)` is false. Undo during
`humanMoveResolving` needs no special case: the human's move is already in
`game`, so it pops exactly as it would from `humanTurn`.

## Boot

```
boot → deserialize(localStorage) ?? newGame()
     → status.over ? gameOver
     : player === human ? humanTurn
     : startAiTurn()
```

A resumed game with the AI to move must start a search on load. Missing this
manifests as a game that appears frozen after a refresh.

## Side effects

`enter(phase)` is the only place that touches the outside world:

```ts
function enter(p: Phase) {
  phase = p;
  renderer.setInputEnabled(p.kind === 'humanTurn');
  renderer.setHints(p.kind === 'humanTurn' ? currentPosition(game).legal : []);
  hud.render(currentPosition(game), phase, canUndo(game));
  persist(game);
  if (p.kind === 'gameOver') audio.play('end');
}
```

Persisting on every phase entry rather than only after moves costs nothing and
means a refresh during an animation resumes correctly.

## Tests

Testable without Pixi if the renderer and audio are injected as interfaces and
the clock is faked:

- Search returns before the animation completes → the move applies once, after
  the animation.
- Search returns after the animation → the move applies once, when the search
  lands.
- Undo during a search → the stale `SEARCH_DONE` is discarded and the board
  matches the popped position.
- Restart during `passNotice` → the queued transition does not fire on the new
  game.
- Rapid double-tap on a legal square → exactly one move applied. Users will
  find this one, so test it rather than trusting the input gate by inspection.
- Resume with the AI to move → a search starts on boot.
