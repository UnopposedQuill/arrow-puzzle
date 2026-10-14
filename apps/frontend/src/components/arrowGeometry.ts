// Where an arrow is drawn, face by face.
//
// An arrow is drawn as a window sliding along a *track*: a sequence of cells
// with the heading at each. A resting arrow's track is just its body, and the
// window covers it exactly. For a move, the track carries on with the cells
// the head slides through (traceMove() in packages/shared) and, when the arrow
// leaves the figure, with cells beyond the edge in the plane of the face it
// left from -- so sliding the window forward animates the move, over edges
// onto other faces and off into the air.
//
// Positions along the track are in cells: s = i is the centre of track[i].
// Between two cells on different faces the line runs to the shared edge on the
// first face and from it on the second, so it reads as one line over the edge.
import { DIR_DELTAS, DIRS, cellKey, neighbor, opposite, type Arrow, type Cell, type Dir, type Figure, type Trace } from '@arrow-puzzle/shared';

export type Point = [x: number, y: number];

export interface TrackCell {
  cell: Cell;
  // Heading when leaving this cell toward the next one.
  dir: Dir;
}

export interface Piece {
  // Polylines on one face, in that face's cell units.
  strokes: Point[][];
  // The arrowhead, if the head is on this face: position and unit direction.
  head: { at: Point; d: Point } | null;
}

const centre = (cell: Cell): Point => [cell.col + 0.5, cell.row + 0.5];
const delta = (dir: Dir): Point => [DIR_DELTAS[dir][1], DIR_DELTAS[dir][0]];
const along = (p: Point, d: Point, k: number): Point => [p[0] + d[0] * k, p[1] + d[1] * k];

// The heading from `a` to the adjacent cell `b`. Track cells beyond the edge
// lie outside their face's grid, so same-face neighbours are found by offset.
function dirToward(figure: Figure, a: Cell, b: Cell): Dir {
  if (a.face === b.face) {
    const same = DIRS.find(d => a.row + DIR_DELTAS[d][0] === b.row && a.col + DIR_DELTAS[d][1] === b.col);
    if (same !== undefined) return same;
  }
  const key = cellKey(b);
  return DIRS.find(d => cellKey(neighbor(figure, a, d).cell) === key)!;
}

export function restingTrack(figure: Figure, arrow: Arrow): TrackCell[] {
  const { cells } = arrow;
  return cells.map((cell, i) => ({ cell, dir: i < cells.length - 1 ? dirToward(figure, cell, cells[i + 1]) : arrow.dir }));
}

// The resting track, then the slide, then -- if the arrow leaves -- enough
// cells past the edge for its tail to clear it.
export function moveTrack(figure: Figure, trace: Trace): TrackCell[] {
  const track = [...restingTrack(figure, trace.arrow), ...trace.path];
  if (trace.exited) {
    const last = track[track.length - 1];
    const [dRow, dCol] = DIR_DELTAS[last.dir];
    for (let k = 1; k <= trace.arrow.cells.length + 1; k++) {
      track.push({ cell: { face: last.cell.face, row: last.cell.row + dRow * k, col: last.cell.col + dCol * k }, dir: last.dir });
    }
  }
  return track;
}

// The point at position `s` on the track: its face, where on it, and the
// direction of travel there. Positions before the start or past the end
// continue straight on.
function pointAt(figure: Figure, track: TrackCell[], s: number): { face: number; at: Point; d: Point } {
  const last = track.length - 1;
  if (s <= 0 || last === 0) {
    const { cell, dir } = s <= 0 ? track[0] : track[last];
    return { face: cell.face, at: along(centre(cell), delta(dir), s <= 0 ? s : s - last), d: delta(dir) };
  }
  if (s >= last) {
    const { cell, dir } = track[last];
    return { face: cell.face, at: along(centre(cell), delta(dir), s - last), d: delta(dir) };
  }
  const i = Math.floor(s);
  const f = s - i;
  const a = track[i];
  const b = track[i + 1];
  if (a.cell.face === b.cell.face || f <= 0.5) {
    return { face: a.cell.face, at: along(centre(a.cell), delta(a.dir), f), d: delta(a.dir) };
  }
  // Past the shared edge: on b's face, arriving the way b is entered.
  const arrival = opposite(dirToward(figure, b.cell, a.cell));
  return { face: b.cell.face, at: along(centre(b.cell), delta(arrival), f - 1), d: delta(arrival) };
}

// The arrow drawn with its tail at `offset` on the track: one Piece per face it
// touches. A one-cell arrow gets a short shaft behind its head.
export function arrowPieces(figure: Figure, track: TrackCell[], length: number, offset: number): Map<number, Piece> {
  const tail = offset - (length === 1 ? 0.35 : 0);
  const headS = offset + length - 1;
  const end = headS + 0.1;

  // Sample the start, every cell centre and edge crossing in between, and the
  // end; an edge crossing yields one point on each face.
  const samples: { face: number; at: Point }[] = [];
  const add = (s: number) => {
    const p = pointAt(figure, track, s);
    samples.push({ face: p.face, at: p.at });
  };
  const last = track.length - 1;
  add(tail);
  for (let i = Math.max(0, Math.floor(tail)); i <= last && i < end; i++) {
    if (i > tail) add(i);
    if (i === last) break;
    const a = track[i];
    const b = track[i + 1];
    if (a.cell.face !== b.cell.face && i + 0.5 > tail && i + 0.5 < end) {
      samples.push({ face: a.cell.face, at: along(centre(a.cell), delta(a.dir), 0.5) });
      const arrival = opposite(dirToward(figure, b.cell, a.cell));
      samples.push({ face: b.cell.face, at: along(centre(b.cell), delta(arrival), -0.5) });
    }
  }
  add(end);

  const pieces = new Map<number, Piece>();
  const pieceFor = (face: number) => {
    let piece = pieces.get(face);
    if (!piece) pieces.set(face, piece = { strokes: [], head: null });
    return piece;
  };
  let stroke: Point[] | null = null;
  let strokeFace = -1;
  for (const { face, at } of samples) {
    if (face !== strokeFace) {
      stroke = [];
      pieceFor(face).strokes.push(stroke);
      strokeFace = face;
    }
    stroke!.push(at);
  }

  const head = pointAt(figure, track, headS);
  pieceFor(head.face).head = { at: head.at, d: head.d };
  return pieces;
}
