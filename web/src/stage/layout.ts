/** Stage geometry in design units (the stage is always 1600 x 900, scaled to fit). */
export const STAGE_W = 1600;
export const STAGE_H = 900;

export interface Spot {
  x: number;
  y: number; // feet
  s: number; // depth scale
  sink?: number; // how far a seated figure drops behind furniture (design units, pre-scale)
  flip?: boolean;
  hidden?: boolean;
}

export const SPOTS = {
  judge: { x: 800, y: 470, s: 0.9 },
  clerk: { x: 515, y: 522, s: 0.74, sink: 30 },
  stand: { x: 1150, y: 522, s: 0.84 },
  door: { x: 1402, y: 522, s: 0.84, hidden: true },
  doorway: { x: 1402, y: 522, s: 0.84 },
  player: { x: 664, y: 800, s: 1.06, sink: 64 },
  playerUp: { x: 664, y: 800, s: 1.06 },
  defendant: { x: 484, y: 800, s: 1, sink: 64 },
  defendantUp: { x: 484, y: 800, s: 1 },
  prosecutor: { x: 1086, y: 800, s: 1.07, sink: 64 },
  prosecutorUp: { x: 1086, y: 800, s: 1.07 },
} satisfies Record<string, Spot>;

/** Five seats: three on the raised back row, two in front. */
export const JUROR_SEATS: Spot[] = [
  { x: 92, y: 474, s: 0.74, sink: 44 },
  { x: 212, y: 474, s: 0.74, sink: 44 },
  { x: 332, y: 474, s: 0.74, sink: 44 },
  { x: 152, y: 566, s: 0.8, sink: 44 },
  { x: 274, y: 566, s: 0.8, sink: 44 },
];

/** Head-top position of a figure standing at a spot (for bubble tails and the spotlight). */
export function headOf(spot: Spot, height = 1): { x: number; y: number } {
  return { x: spot.x, y: spot.y + (spot.sink ?? 0) * spot.s - 318 * spot.s * height };
}

export function spotTransform(spot: Spot): string {
  const sx = spot.flip ? -spot.s : spot.s;
  return `translate(${spot.x}px, ${spot.y + (spot.sink ?? 0) * spot.s}px) scale(${sx}, ${spot.s})`;
}
