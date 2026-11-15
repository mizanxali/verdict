/**
 * Stage geometry in design units (the stage is always 1600 x 900, scaled to fit).
 *
 * The courtroom is a Blender render (art/blender). Where each figure stands, how large it
 * is at that depth, and how far a seated figure sinks behind furniture all come from the
 * render's manifest (court.json), projected from the same camera, so the cast and the set
 * always agree.
 */
import court from "./court.json";

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

type Raw = { x: number; y: number; s: number; sink?: number };
const raw = court.spots as Record<string, Raw>;
const at = (k: string): Spot => {
  const r = raw[k];
  if (!r) throw new Error(`court.json has no spot "${k}"`);
  return { x: r.x, y: r.y, s: r.s, ...(r.sink ? { sink: r.sink } : {}) };
};
const standing = (k: string): Spot => {
  const { sink: _sink, ...rest } = at(k);
  return rest;
};

export const SPOTS = {
  judge: at("judge"),
  clerk: at("clerk"),
  stand: at("stand"),
  door: { ...at("doorway"), hidden: true },
  doorway: at("doorway"),
  player: at("player"),
  playerUp: standing("player"),
  defendant: at("defendant"),
  defendantUp: standing("defendant"),
  prosecutor: at("prosecutor"),
  prosecutorUp: standing("prosecutor"),
  mid1: at("mid1"),
  mid2: at("mid2"),
} satisfies Record<string, Spot>;

/** Five seats: three on the raised back row, two in front. */
export const JUROR_SEATS: Spot[] = [0, 1, 2, 3, 4].map((i) => at(`juror${i}`));

export type Quad = [number, number][];
export const PLATES = court.plates as { bench: Quad; stand: Quad };
export const DOOR_LEAF = court.doorLeaf as Quad;

export interface LayerRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const LAYERS = court.layers as Record<string, LayerRect>;

/** Head-top position of a figure standing at a spot (for bubble tails and the spotlight). */
export function headOf(spot: Spot, height = 1): { x: number; y: number } {
  return { x: spot.x, y: spot.y + (spot.sink ?? 0) * spot.s - 318 * spot.s * height };
}

export function spotTransform(spot: Spot): string {
  const sx = spot.flip ? -spot.s : spot.s;
  return `translate(${spot.x}px, ${spot.y + (spot.sink ?? 0) * spot.s}px) scale(${sx}, ${spot.s})`;
}
