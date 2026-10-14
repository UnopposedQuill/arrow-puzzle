// The arrow game on a figure.
//
// An arrow is a path of cells, tail first and head last, plus the heading of
// its head. Tapping it slides it head-first, one cell at a time, with the body
// following the path the head took, and is cleared as soon as its head crosses
// an open edge. What happens when the next cell is taken depends on the
// `blockedArrows` rule:
//
//   'return' (default) -- the arrow goes back to where it started, so only
//                         clearing changes the board and it can never deadlock.
//   'stay'   (harder)  -- the arrow stays where it stopped. Careless moves can
//                         then leave the board unsolvable.
//
// Every tap on an arrow on the board is a move, including one that leaves the
// board unchanged: attempting a blocked arrow costs a move.
import { mulberry32 } from './rng.js';
import { buildCube, neighbor, opposite, step, DIRS, type Cell, type Dir, type Figure } from './figure.js';

export interface Arrow {
  id: number;
  cells: Cell[];
  dir: Dir;
}

export type BlockedArrows = 'return' | 'stay';
export const BLOCKED_ARROWS: readonly BlockedArrows[] = ['return', 'stay'];

export interface GameState {
  figure: Figure;
  arrows: Arrow[];
  blockedArrows: BlockedArrows;
}

// A move names the arrow that was tapped.
export type Move = number;

export interface PuzzleOptions {
  size: number;
  maxLength: number;
  blockedArrows: BlockedArrows;
}

export const DEFAULT_OPTIONS: PuzzleOptions = { size: 10, maxLength: 8, blockedArrows: 'return' };

// Bounds the server enforces, since options arrive from the client and
// generation cost grows with them.
export const OPTION_LIMITS = {
  size: { min: 2, max: 16 },
  maxLength: { min: 1, max: 20 },
} as const;

export function isValidOptions(options: PuzzleOptions): boolean {
  return BLOCKED_ARROWS.includes(options.blockedArrows) &&
    (Object.keys(OPTION_LIMITS) as (keyof typeof OPTION_LIMITS)[]).every(key => {
      const value = options[key];
      return Number.isInteger(value) && value >= OPTION_LIMITS[key].min && value <= OPTION_LIMITS[key].max;
    });
}

export const cellKey = (cell: Cell) => `${cell.face}:${cell.row}:${cell.col}`;

const occupiedBy = (arrows: Arrow[]) => new Set(arrows.flatMap(a => a.cells.map(cellKey)));

// --- Generation ---
//
// Arrows are placed one at a time, and each is kept only if its path from the
// head to the edge is clear of everything placed before it. Clearing arrows in
// reverse placement order (highest id first) therefore always solves the board.
//
// Long arrows go first: during the first three quarters of the attempts an
// arrow is kept only if its body reached at least half of maxLength. The rest
// fill whatever gaps are left, at any length.
export function generatePuzzle(seed: number, options: PuzzleOptions = DEFAULT_OPTIONS): GameState {
  const rand = mulberry32(seed);
  const randInt = (n: number) => Math.floor(rand() * n);
  const figure = buildCube(options.size);
  const n = options.size;
  const occupied = new Set<string>();
  const arrows: Arrow[] = [];

  const attempts = figure.faces.length * n * n * 4;
  const minLength = Math.ceil(options.maxLength / 2);
  for (let i = 0; i < attempts; i++) {
    const head: Cell = { face: randInt(figure.faces.length), row: randInt(n), col: randInt(n) };
    const dir = DIRS[randInt(DIRS.length)];
    if (occupied.has(cellKey(head))) continue;

    // Lengths are drawn from the top half of the range, so arrows are long by
    // default; shorter ones still appear where a body runs out of room.
    const length = options.maxLength - randInt(Math.ceil(options.maxLength / 2));
    const cells = growBody(figure, head, dir, length, occupied, rand);
    if (i < attempts * 0.75 && cells.length < minLength) continue;
    const own = new Set(cells.map(cellKey));
    if (!pathIsClear(figure, head, dir, key => occupied.has(key) || own.has(key))) continue;

    cells.forEach(c => occupied.add(cellKey(c)));
    arrows.push({ id: arrows.length, cells, dir });
  }
  return { figure, arrows, blockedArrows: options.blockedArrows };
}

// Chance that a body keeps going straight when it could. Straight runs curl
// into themselves less, so bodies reach their length more often.
const STRAIGHT_BIAS = 0.6;

// Walks backwards from the head over free cells, returning the path tail first.
// The body may wrap over edges onto other faces. The cell right behind the head
// is always in line with its heading; after that the body may bend. It ends
// early if it runs out of room.
function growBody(
  figure: Figure, head: Cell, dir: Dir, length: number, occupied: Set<string>, rand: () => number,
): Cell[] {
  const body = [head];
  const taken = (c: Cell) => occupied.has(cellKey(c)) || body.some(b => cellKey(b) === cellKey(c));
  // The direction the walk is heading, in the current cell's face terms.
  let back = opposite(dir);
  while (body.length < length) {
    const current = body[body.length - 1];
    const options = (body.length === 1 ? [back] : DIRS)
      .map(d => ({ d, ...neighbor(figure, current, d) }))
      .filter(o => !taken(o.cell));
    if (options.length === 0) break;
    const straight = options.find(o => o.d === back);
    const next = straight && rand() < STRAIGHT_BIAS ? straight : options[Math.floor(rand() * options.length)];
    body.push(next.cell);
    back = next.dir;
  }
  return body.reverse();
}

function pathIsClear(figure: Figure, head: Cell, dir: Dir, blocked: (key: string) => boolean): boolean {
  let at = step(figure, head, dir);
  while (at.kind === 'cell') {
    if (blocked(cellKey(at.cell))) return false;
    at = step(figure, at.cell, at.dir);
  }
  return true;
}

// --- Moves ---
// Moves arrive from the client and are untrusted: anything that is not a
// movable arrow leaves the state untouched rather than throwing.
export function applyMove(state: GameState, move: Move): GameState {
  const arrow = state.arrows.find(a => a.id === move);
  if (!arrow) return state;

  const others = occupiedBy(state.arrows.filter(a => a !== arrow));
  let { cells, dir } = arrow;
  for (;;) {
    const next = step(state.figure, cells[cells.length - 1], dir);
    if (next.kind === 'exit') {
      return { ...state, arrows: state.arrows.filter(a => a !== arrow) };
    }
    const key = cellKey(next.cell);
    // The tail vacates as the head advances, so only the rest of the body blocks.
    if (others.has(key) || cells.slice(1).some(c => cellKey(c) === key)) break;
    cells = [...cells.slice(1), next.cell];
    dir = next.dir;
  }
  if (cells === arrow.cells || state.blockedArrows === 'return') return state;
  return { ...state, arrows: state.arrows.map(a => (a === arrow ? { ...a, cells, dir } : a)) };
}

// Whether `move` names an arrow on the board, i.e. whether tapping it counts as
// a move. It may still be blocked and leave the board unchanged.
export function isValidMove(state: GameState, move: Move): boolean {
  return state.arrows.some(a => a.id === move);
}

export function replayMoves(initialState: GameState, moves: Move[]): GameState {
  return moves.reduce(applyMove, initialState);
}

export function checkWin(state: GameState): boolean {
  return state.arrows.length === 0;
}
