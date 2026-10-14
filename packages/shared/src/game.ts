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
import { buildFigure, neighbor, opposite, step, DIRS, FIGURE_KINDS, type Cell, type Dir, type Figure, type FigureKind } from './figure.js';

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
  figure: FigureKind;
  size: number;
  maxLength: number;
  blockedArrows: BlockedArrows;
}

export const DEFAULT_OPTIONS: PuzzleOptions = { figure: 'cube', size: 16, maxLength: 16, blockedArrows: 'return' };

// Bounds the server enforces, since options arrive from the client and
// generation cost grows with them.
export const OPTION_LIMITS = {
  size: { min: 2, max: 24 },
  maxLength: { min: 1, max: 24 },
} as const;

export function isValidOptions(options: PuzzleOptions): boolean {
  return BLOCKED_ARROWS.includes(options.blockedArrows) && FIGURE_KINDS.includes(options.figure) &&
    (Object.keys(OPTION_LIMITS) as (keyof typeof OPTION_LIMITS)[]).every(key => {
      const value = options[key];
      return Number.isInteger(value) && value >= OPTION_LIMITS[key].min && value <= OPTION_LIMITS[key].max;
    });
}

export const cellKey = (cell: Cell) => `${cell.face}:${cell.row}:${cell.col}`;

const occupiedBy = (arrows: Arrow[]) => new Set(arrows.flatMap(a => a.cells.map(cellKey)));

// --- Generation ---
//
// Arrows are cleared in reverse id order (highest first), and generation
// builds that order from both ends, which is what keeps every board solvable:
//
//   - an arrow added to the FRONT is cleared before all the others, so its path
//     from head to edge must be clear of every arrow already placed;
//   - an arrow added to the BACK is cleared after all the others, when the
//     board is empty, so its own path doesn't matter -- but it must not sit on
//     the path of any arrow already placed.
//
// Front placement alone leaves gaps: once the board is dense, most free cells
// have a blocked path in every direction. Many of them can still take a back
// arrow, which fills the board much more evenly.
//
// Long arrows go first: during the first three quarters of the random attempts
// an arrow is kept only if its body reached at least half of maxLength. The
// rest, and a final sweep over every free cell, fill the gaps with arrows of
// at least FILLER_MIN_LENGTH.
// Shortest arrow used to fill gaps. At the defaults (16/16): 1 fills ~91% of
// cells but adds ~140 one- and two-cell stubs; 2 fills ~88.5% with ~30; 3
// fills ~86% with none.
const FILLER_MIN_LENGTH = 2;

export function generatePuzzle(seed: number, options: PuzzleOptions = DEFAULT_OPTIONS): GameState {
  const rand = mulberry32(seed);
  const randInt = (n: number) => Math.floor(rand() * n);
  const figure = buildFigure(options.figure, options.size);
  const n = figure.size;
  const occupied = new Set<string>();
  // Cells on the path from head to edge of any placed arrow.
  const onSomePath = new Set<string>();
  // Arrows added to the front (cleared first) and to the back (cleared last),
  // each in the order they were added.
  const front: Omit<Arrow, 'id'>[] = [];
  const back: Omit<Arrow, 'id'>[] = [];

  // Lengths are drawn from the top half of the range, so arrows are long by
  // default; shorter ones still appear where a body runs out of room.
  const randomLength = () => options.maxLength - randInt(Math.ceil(options.maxLength / 2));

  const place = (head: Cell, dir: Dir, minLength: number): boolean => {
    if (occupied.has(cellKey(head))) return false;
    const cells = growBody(figure, head, dir, randomLength(), occupied, rand);
    if (cells.length < minLength) return false;
    const keys = cells.map(cellKey);
    const path = pathKeys(figure, head, dir);
    // Never pointing into its own body, wherever it goes in the order.
    if (path.some(k => keys.includes(k))) return false;
    const toFront = path.every(k => !occupied.has(k));
    if (!toFront && keys.some(k => onSomePath.has(k))) return false;
    keys.forEach(k => occupied.add(k));
    path.forEach(k => onSomePath.add(k));
    (toFront ? front : back).push({ cells, dir });
    return true;
  };

  const attempts = figure.faces.length * n * n * 4;
  for (let i = 0; i < attempts; i++) {
    const head: Cell = { face: randInt(figure.faces.length), row: randInt(n), col: randInt(n) };
    place(head, DIRS[randInt(DIRS.length)], i < attempts * 0.75 ? Math.ceil(options.maxLength / 2) : FILLER_MIN_LENGTH);
  }

  // Sweep: offer every cell still free, in random order, every heading.
  const cells = figure.faces.flatMap((_, face) =>
    Array.from({ length: n * n }, (_, i): Cell => ({ face, row: Math.floor(i / n), col: i % n })));
  for (const head of shuffle(cells, rand)) {
    for (const dir of shuffle([...DIRS], rand)) {
      if (place(head, dir, FILLER_MIN_LENGTH)) break;
    }
  }

  // Ids follow the clearing order: the back, latest addition first, then the
  // front in the order it was built.
  const arrows = [...back.reverse(), ...front].map((a, id) => ({ id, ...a }));
  return { figure, arrows, blockedArrows: options.blockedArrows };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
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

// The cells an arrow at `head` heading `dir` passes through on its way to the
// edge, not counting the head itself.
function pathKeys(figure: Figure, head: Cell, dir: Dir): string[] {
  const keys: string[] = [];
  let at = step(figure, head, dir);
  while (at.kind === 'cell') {
    keys.push(cellKey(at.cell));
    at = step(figure, at.cell, at.dir);
  }
  return keys;
}



// --- Moves ---

export interface Trace {
  arrow: Arrow;
  // Where the head goes, one cell per step, with its heading there.
  path: { cell: Cell; dir: Dir }[];
  // Whether the head went over an open edge, clearing the arrow; otherwise it
  // was blocked after `path`.
  exited: boolean;
}

// How a tap on `move` plays out: the cells the head slides through and how
// the slide ends. applyMove() is built on it, and the frontend animates it, so
// the animation always shows exactly what the rules did. Null when `move` is
// not an arrow on the board.
export function traceMove(state: GameState, move: Move): Trace | null {
  const arrow = state.arrows.find(a => a.id === move);
  if (!arrow) return null;

  const others = occupiedBy(state.arrows.filter(a => a !== arrow));
  const path: Trace['path'] = [];
  let { cells, dir } = arrow;
  for (;;) {
    const next = step(state.figure, cells[cells.length - 1], dir);
    if (next.kind === 'exit') return { arrow, path, exited: true };
    const key = cellKey(next.cell);
    // The tail vacates as the head advances, so only the rest of the body blocks.
    if (others.has(key) || cells.slice(1).some(c => cellKey(c) === key)) break;
    cells = [...cells.slice(1), next.cell];
    dir = next.dir;
    path.push({ cell: next.cell, dir });
  }
  return { arrow, path, exited: false };
}

// Moves arrive from the client and are untrusted: anything that is not a
// movable arrow leaves the state untouched rather than throwing.
export function applyMove(state: GameState, move: Move): GameState {
  const trace = traceMove(state, move);
  if (!trace) return state;
  const { arrow, path, exited } = trace;
  if (exited) return { ...state, arrows: state.arrows.filter(a => a !== arrow) };
  if (path.length === 0 || state.blockedArrows === 'return') return state;
  const cells = [...arrow.cells, ...path.map(p => p.cell)].slice(path.length);
  const dir = path[path.length - 1].dir;
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
