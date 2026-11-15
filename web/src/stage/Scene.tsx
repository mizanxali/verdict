/**
 * The courtroom set: pre-rendered depth layers from Blender (art/blender/courtroom.py).
 * Each export is one layer; Courtroom.tsx interleaves them with the cast so furniture hides
 * whoever stands behind it. Only the things that change during a trial are drawn live: the
 * engraved nameplates, the swinging door, and the light that spills through it.
 */
import { DOOR_LEAF, LAYERS, PLATES, type Quad } from "./layout";

const BASE = import.meta.env.BASE_URL;
export const layerUrl = (id: string) => `${BASE}art/court/${id}.webp`;

/** Every layer image, so the title screen can warm the cache before the trial opens. */
export const ALL_LAYERS = Object.keys(LAYERS);

export function Layer({ id, className }: { id: string; className?: string }) {
  const r = LAYERS[id];
  if (!r) return null;
  return <image href={layerUrl(id)} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" className={className} />;
}

function quadBox(q: Quad) {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Letters cut into a brass plate: dark fill, a hairline of light below each stroke. */
function Engraved({ q, text, max = 0.62 }: { q: Quad; text: string; max?: number }) {
  const b = quadBox(q);
  const size = b.h * max;
  // shrink long names to the plate
  const fit = Math.min(size, (b.w * 0.86) / Math.max(1, text.length * 0.66));
  return (
    <g className="plate-text" aria-hidden>
      <text x={b.cx} y={b.cy + fit * 0.36 + 0.6} textAnchor="middle" fontSize={fit} className="plate-light">
        {text}
      </text>
      <text x={b.cx} y={b.cy + fit * 0.36} textAnchor="middle" fontSize={fit} className="plate-ink">
        {text}
      </text>
    </g>
  );
}

export function BackWall() {
  return <Layer id="back" />;
}

export function Bench({ judgeName }: { judgeName: string }) {
  return (
    <g>
      <Layer id="bench" />
      <Engraved q={PLATES.bench} text={judgeName.toUpperCase()} />
    </g>
  );
}

export function ClerkDesk() {
  return <Layer id="clerk" />;
}

export function WitnessStand({ name }: { name: string | null }) {
  return (
    <g>
      <Layer id="stand" />
      <Engraved q={PLATES.stand} text={name ? name.toUpperCase() : "WITNESS"} max={0.58} />
    </g>
  );
}

const leaf = quadBox(DOOR_LEAF);

/** The door leaf swings on its right-hand hinge; corridor light spills out while it is open. */
export function DoorLeaf({ open }: { open: boolean }) {
  return (
    <g>
      <path
        className={`door-spill${open ? " open" : ""}`}
        d={`M ${leaf.x} ${leaf.y + leaf.h} L ${leaf.x + leaf.w} ${leaf.y + leaf.h} L ${leaf.x + leaf.w * 1.55} ${leaf.y + leaf.h * 1.32} L ${leaf.x - leaf.w * 0.65} ${leaf.y + leaf.h * 1.32} Z`}
        fill="url(#g-spill)"
      />
      <g className={`door-leaf${open ? " open" : ""}`} style={{ transformOrigin: `${leaf.x + leaf.w}px ${leaf.y}px` }}>
        <Layer id="door" />
      </g>
    </g>
  );
}

export function JuryBack() {
  return <Layer id="juryback" />;
}

export function JuryMid() {
  return <Layer id="jurymid" />;
}

export function JuryFront() {
  return <Layer id="juryfront" />;
}

export function CounselTables() {
  return <Layer id="tables" />;
}

export function GalleryRail() {
  return <Layer id="rail" />;
}

/** Light in the air: the window shafts and lamp halos, over everyone. */
export function Haze() {
  return <Layer id="haze" className="haze" />;
}

export function SceneDefs() {
  return (
    <defs>
      <radialGradient id="g-spill" cx="0.5" cy="0" r="0.9">
        <stop offset="0" stopColor="#ffcf8a" stopOpacity="0.45" />
        <stop offset="1" stopColor="#ffcf8a" stopOpacity="0" />
      </radialGradient>
      {/* the cast sits in the same light as the set: warm from the windows, cool in the shadows */}
      <filter id="f-cast" x="-20%" y="-10%" width="140%" height="120%" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="0.93 0.05 0 0 0.012  0.02 0.88 0.02 0 0.006  0 0.04 0.8 0 0.004  0 0 0 1 0" />
      </filter>
    </defs>
  );
}
