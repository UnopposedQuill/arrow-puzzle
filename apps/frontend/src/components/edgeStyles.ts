import type { EdgeType } from '@arrow-puzzle/shared';

// How each edge type is drawn (widths in screen px). Edge lines are part of
// each face's drawing, *under* the arrows, so an arrow crossing an edge runs
// over it unbroken; flat seams between faces of one side get no line. Turn
// edges also get chevrons pointing the way heads turn.
export const EDGE_STYLES: Record<EdgeType, { color: string; width: number; label: string }> = {
  open: { color: 'rgba(255, 255, 255, 0.85)', width: 1.5, label: 'open: arrows leave' },
  sticky: { color: '#27ae60', width: 4, label: 'sticky: carries on' },
  mirror: { color: '#3498db', width: 4, label: 'mirror: bounces back' },
  turn: { color: '#e67e22', width: 3, label: 'turn: follows the chevrons' },
};
