/**
 * Parametric flat-colour characters. Every figure shares one skeleton (feet at the origin,
 * about 300 units tall, facing the viewer in a theatrical "cheat out"), and a design picks the
 * build, hair, outfit, accessories and palette. Moods and poses are props; idle motion,
 * blinking, talking and walking are CSS animations keyed off class names.
 */
import { memo, useId, type CSSProperties, type ReactNode } from "react";
import { P } from "./palette";

export type HairStyle =
  | "crop"
  | "receding"
  | "slick"
  | "pixie"
  | "bob"
  | "bunMessy"
  | "bunTight"
  | "afro"
  | "sidePart"
  | "bald"
  | "beanie"
  | "curly"
  | "ponytail"
  | "wavy";

export type Outfit = "suit" | "robe" | "uniform" | "blazer" | "cardigan" | "zip" | "flannel" | "tweed" | "sweater";

export type Accessory =
  | "glassesRound"
  | "glassesRect"
  | "glassesHalf"
  | "glassesThick"
  | "glassesChain"
  | "tie"
  | "bowtie"
  | "pearls"
  | "badge"
  | "brooch"
  | "lanyard"
  | "pocketSquare"
  | "moustache"
  | "beard"
  | "stubble"
  | "earrings"
  | "lipstick"
  | "wrinkles"
  | "freckles"
  | "scarf"
  | "gavel"
  | "clipboard";

export interface Design {
  skin: string;
  hair: string;
  hair2?: string; // streaks, temples, beanie cuff
  hairStyle: HairStyle;
  outfit: Outfit;
  top: string; // jacket, robe, cardigan
  under: string; // shirt or blouse
  accent: string; // tie, scarf, stripe
  bottom: string;
  shoes: string;
  build: number; // horizontal scale, ~0.9 slim .. 1.25 stout
  height: number; // overall scale, ~0.94 .. 1.06
  skirt?: boolean;
  acc: Accessory[];
  brows?: "thin" | "thick";
}

export type Mood = "neutral" | "stern" | "smug" | "anxious" | "shocked" | "broken" | "relieved" | "happy" | "sad" | "focused";
export type Pose = "rest" | "folded" | "gesture" | "raise" | "gavelUp" | "gavelDown" | "present" | "clasp" | "slump" | "write";

/** Upper-arm and forearm angles (degrees) for the viewer-left arm (A) and viewer-right arm (B). */
const POSES: Record<Pose, { a: [number, number]; b: [number, number] }> = {
  rest: { a: [7, -4], b: [-7, 4] },
  folded: { a: [16, -98], b: [-16, 98] },
  gesture: { a: [7, -4], b: [-26, -70] },
  raise: { a: [7, -4], b: [-158, 8] },
  gavelUp: { a: [16, -98], b: [-112, -40] },
  gavelDown: { a: [16, -98], b: [-52, -46] },
  present: { a: [7, -4], b: [-58, -34] },
  clasp: { a: [22, -112], b: [-22, 112] },
  slump: { a: [3, -2], b: [-3, 2] },
  write: { a: [16, -98], b: [-30, 80] },
};

const MOOD_FACE: Record<
  Mood,
  { brow: number; browY: number; eyes: "dot" | "wide" | "lidded" | "narrow" | "happy"; mouth: "flat" | "smile" | "frown" | "smug" | "o" | "wobble" | "grin" }
> = {
  neutral: { brow: 0, browY: 0, eyes: "dot", mouth: "flat" },
  focused: { brow: 6, browY: 1, eyes: "dot", mouth: "flat" },
  stern: { brow: 14, browY: 2, eyes: "narrow", mouth: "flat" },
  smug: { brow: -4, browY: -1, eyes: "narrow", mouth: "smug" },
  anxious: { brow: -14, browY: -2, eyes: "dot", mouth: "wobble" },
  shocked: { brow: -6, browY: -6, eyes: "wide", mouth: "o" },
  broken: { brow: -16, browY: -1, eyes: "lidded", mouth: "frown" },
  relieved: { brow: -10, browY: -2, eyes: "happy", mouth: "smile" },
  happy: { brow: -2, browY: -3, eyes: "happy", mouth: "grin" },
  sad: { brow: -16, browY: -2, eyes: "lidded", mouth: "frown" },
};

const hashOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
};

/** Stable per-character animation offsets so nobody breathes or blinks in unison. */
export function idleVars(seed: string): CSSProperties {
  const h = hashOf(seed);
  return {
    ["--breathe-delay" as string]: `${-((h % 1000) / 1000) * 4}s`,
    ["--blink-delay" as string]: `${-((Math.floor(h / 7) % 1000) / 1000) * 5.5}s`,
    ["--blink-dur" as string]: `${4.6 + ((h >> 5) % 30) / 10}s`,
    ["--sway-delay" as string]: `${-((Math.floor(h / 13) % 1000) / 1000) * 9}s`,
    ["--talk-dur" as string]: `${0.16 + ((h >> 3) % 6) / 100}s`,
  };
}

const shadeOf = "rgba(27,16,40,0.22)";

// ───────────────────────────── hair ─────────────────────────────

function HairBack({ d }: { d: Design }) {
  const c = d.hair;
  switch (d.hairStyle) {
    case "bob":
      return <path d="M -35 -12 C -38 -40 -18 -50 2 -49 C 24 -48 38 -38 35 -12 L 37 22 C 30 28 22 28 17 26 L 17 -2 L -17 -2 L -17 26 C -22 28 -30 28 -37 22 Z" fill={c} />;
    case "bunMessy":
      return (
        <g fill={c}>
          <circle cx={13} cy={-42} r={14} />
          <circle cx={4} cy={-47} r={7} />
          <path d="M -30 -4 Q -36 12 -31 26 L -27 24 Q -30 10 -26 -2 Z" />
        </g>
      );
    case "bunTight":
      return <circle cx={0} cy={-47} r={11} fill={c} />;
    case "afro":
      return <ellipse cx={0} cy={-12} rx={41} ry={38} fill={c} />;
    case "curly":
      return (
        <g fill={c}>
          {[
            [-25, -14, 11],
            [-18, -29, 12],
            [-5, -37, 12],
            [9, -36, 12],
            [22, -28, 11],
            [28, -14, 9],
          ].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} />
          ))}
        </g>
      );
    case "ponytail":
      return <path d="M 18 -34 C 40 -36 44 -6 36 22 C 34 30 28 32 26 26 C 32 6 30 -14 16 -22 Z" fill={c} />;
    case "wavy":
      return <path d="M -34 -6 C -38 -38 -16 -50 2 -48 C 24 -46 38 -34 34 -6 C 38 6 34 16 30 20 L 24 4 L -24 4 L -30 20 C -35 14 -38 4 -34 -6 Z" fill={c} />;
    default:
      return null;
  }
}

function HairFront({ d }: { d: Design }) {
  const c = d.hair;
  const c2 = d.hair2 ?? c;
  switch (d.hairStyle) {
    case "crop":
      return <path d="M -30 -4 C -32 -30 -16 -42 2 -41 C 20 -40 32 -28 30 -4 C 27 -15 24 -20 18 -22 C 8 -18 -10 -19 -20 -23 C -26 -18 -28 -12 -30 -4 Z" fill={c} />;
    case "receding":
      return (
        <g fill={c}>
          <path d="M -30 -2 C -31 -20 -27 -30 -19 -34 L -15 -24 C -22 -19 -27 -12 -30 -2 Z" />
          <path d="M 30 -2 C 31 -20 27 -30 19 -34 L 15 -24 C 22 -19 27 -12 30 -2 Z" />
          <path d="M -18 -34 C -8 -40 8 -40 18 -34 L 15 -30 C 6 -34 -6 -34 -15 -30 Z" />
        </g>
      );
    case "slick":
      return (
        <g>
          <path d="M -30 -2 C -33 -32 -14 -46 6 -44 C 24 -42 34 -28 30 -2 C 28 -18 22 -26 8 -29 C -6 -31 -20 -27 -26 -16 C -28 -12 -29 -7 -30 -2 Z" fill={c} />
          <path d="M -30 -2 C -30 -8 -29 -14 -27 -18 L -24 -10 Z M 30 -2 C 30 -8 29 -14 27 -18 L 24 -10 Z" fill={c2} />
          <path d="M -14 -36 C -2 -42 12 -40 22 -32" stroke={c2} strokeWidth={2.4} fill="none" opacity={0.7} />
        </g>
      );
    case "pixie":
      return <path d="M -31 0 C -34 -30 -18 -45 2 -44 C 22 -44 34 -30 31 0 C 29 -12 26 -18 21 -21 L 15 -14 L 11 -23 L 3 -16 L -3 -25 L -11 -16 L -15 -25 C -23 -21 -29 -12 -31 0 Z" fill={c} />;
    case "bob":
      return <path d="M -31 -2 C -32 -34 -10 -46 8 -45 C 26 -44 35 -30 32 -2 C 28 -14 18 -24 0 -27 C -12 -25 -22 -18 -26 -4 Z" fill={c} />;
    case "bunMessy":
      return (
        <g>
          <path d="M -30 -2 C -31 -30 -14 -42 4 -41 C 22 -40 31 -28 30 -2 C 25 -20 12 -28 -2 -27 C -16 -26 -26 -16 -30 -2 Z" fill={c} />
          <path d="M -22 -24 Q -28 -6 -24 8 M 25 -20 Q 31 -4 28 12" stroke={c} strokeWidth={3} fill="none" strokeLinecap="round" />
        </g>
      );
    case "bunTight":
      return (
        <g>
          <path d="M -30 -2 C -31 -32 -14 -41 0 -41 C 14 -41 31 -32 30 -2 C 26 -22 14 -30 0 -30 C -14 -30 -26 -22 -30 -2 Z" fill={c} />
          <path d="M 0 -41 L 0 -31" stroke={c2} strokeWidth={1.6} />
        </g>
      );
    case "afro":
      return <path d="M -30 -6 C -27 -27 -12 -31 0 -31 C 12 -31 27 -27 30 -6 C 34 -38 16 -50 0 -50 C -16 -50 -34 -38 -30 -6 Z" fill={c} />;
    case "sidePart":
      return (
        <g>
          <path d="M -30 -2 C -33 -30 -18 -43 0 -43 C 20 -43 33 -30 30 -2 C 28 -18 22 -26 10 -28 L -9 -34 C -18 -28 -26 -18 -30 -2 Z" fill={c} />
          <path d="M -9 -34 L -12 -42" stroke={shadeOf} strokeWidth={1.6} />
        </g>
      );
    case "bald":
      return (
        <g>
          <path d="M -30 -2 C -31 -14 -29 -20 -26 -24 L -22 -9 C -26 -7 -28 -5 -30 -2 Z M 30 -2 C 31 -14 29 -20 26 -24 L 22 -9 C 26 -7 28 -5 30 -2 Z" fill={c} />
          <ellipse cx={-9} cy={-26} rx={9} ry={5} fill="#fff" opacity={0.18} transform="rotate(-20 -9 -26)" />
        </g>
      );
    case "beanie":
      return (
        <g>
          <path d="M -31 4 C -33 -6 -32 -12 -28 -14 L -24 6 Z M 31 4 C 33 -6 32 -12 28 -14 L 24 6 Z" fill={c} />
          <path d="M -32 -8 C -34 -38 -16 -52 0 -52 C 16 -52 34 -38 32 -8 Z" fill={d.accent} />
          <rect x={-34} y={-16} width={68} height={12} rx={5} fill={c2} />
          {[-22, -11, 0, 11, 22].map((x) => (
            <line key={x} x1={x} y1={-14} x2={x} y2={-6} stroke={shadeOf} strokeWidth={1.4} />
          ))}
        </g>
      );
    case "curly":
      return (
        <g fill={c}>
          {[
            [-22, -22, 9],
            [-12, -28, 9],
            [0, -31, 9],
            [12, -29, 9],
            [22, -22, 8],
          ].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} />
          ))}
        </g>
      );
    case "ponytail":
      return <path d="M -30 -2 C -32 -30 -14 -43 4 -42 C 22 -41 32 -28 30 -4 C 22 -16 6 -26 -12 -26 C -20 -22 -27 -14 -30 -2 Z" fill={c} />;
    case "wavy":
      return <path d="M -31 -2 C -33 -34 -12 -46 6 -45 C 26 -44 35 -30 31 -2 C 27 -12 22 -16 16 -20 C 10 -14 2 -20 -4 -24 C -10 -18 -20 -18 -24 -14 C -28 -10 -30 -6 -31 -2 Z" fill={c} />;
  }
}

// ───────────────────────────── face ─────────────────────────────

function Eyes({ kind, skin }: { kind: (typeof MOOD_FACE)[Mood]["eyes"]; skin: string }) {
  const eye = (x: number) => {
    switch (kind) {
      case "wide":
        return (
          <g key={x} transform={`translate(${x} -2)`}>
            <ellipse rx={6} ry={6.6} fill="#fff" />
            <circle r={2.6} fill={P.ink} />
          </g>
        );
      case "lidded":
        return (
          <g key={x} transform={`translate(${x} -1)`}>
            <ellipse rx={3.6} ry={4} fill={P.ink} />
            <rect x={-5} y={-6} width={10} height={5.5} fill={skin} />
            <line x1={-5} y1={-0.5} x2={5} y2={-0.5} stroke={P.ink} strokeWidth={1.6} strokeLinecap="round" />
          </g>
        );
      case "narrow":
        return <ellipse key={x} cx={x} cy={-2} rx={3.6} ry={2.8} fill={P.ink} />;
      case "happy":
        return <path key={x} d={`M ${x - 4.5} -1 Q ${x} -6.5 ${x + 4.5} -1`} stroke={P.ink} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
      default:
        return <ellipse key={x} cx={x} cy={-2} rx={3.4} ry={4.4} fill={P.ink} />;
    }
  };
  return (
    <g className="ch-eyes">
      {eye(-11.5)}
      {eye(11.5)}
    </g>
  );
}

function Mouth({ kind, d, talking }: { kind: (typeof MOOD_FACE)[Mood]["mouth"]; d: Design; talking: boolean }) {
  const lip = d.acc.includes("lipstick") ? "#b23a48" : P.ink;
  if (talking) {
    return (
      <g transform="translate(0 19)">
        <g className="ch-mouth-talk">
          <ellipse rx={6.4} ry={4.8} fill="#5a1f2a" />
          <ellipse cx={0} cy={2.4} rx={3.6} ry={1.8} fill="#c4505a" />
        </g>
        {d.acc.includes("lipstick") && <path d="M -6 -2 Q 0 -4 6 -2" stroke={lip} strokeWidth={2} fill="none" />}
      </g>
    );
  }
  const w = d.acc.includes("lipstick") ? 3 : 2.4;
  const path = {
    flat: "M -7 19 Q 0 20.5 7 19",
    smile: "M -8 17.5 Q 0 24 8 17.5",
    grin: "M -9 16.5 Q 0 27 9 16.5 Z",
    frown: "M -7 22 Q 0 16.5 7 22",
    smug: "M -7 20 Q 2 22 9 16.5",
    wobble: "M -7 20 Q -3.5 17.5 0 20 Q 3.5 22.5 7 19.5",
    o: "",
  }[kind];
  if (kind === "o") return <ellipse cx={0} cy={21} rx={4.6} ry={6} fill="#5a1f2a" />;
  if (kind === "grin") return <path d={path} fill="#5a1f2a" stroke={lip} strokeWidth={2} strokeLinejoin="round" />;
  return <path d={path} stroke={lip} strokeWidth={w} fill="none" strokeLinecap="round" />;
}

function Glasses({ d }: { d: Design }) {
  const frame = d.acc.includes("glassesThick") ? "#2a2230" : d.acc.includes("glassesHalf") ? P.brassDark : "#3b2f3f";
  const lens = "rgba(220,235,245,0.22)";
  if (d.acc.includes("glassesRound"))
    return (
      <g stroke={frame} strokeWidth={2.2} fill={lens}>
        <circle cx={-12} cy={-2} r={8.5} />
        <circle cx={12} cy={-2} r={8.5} />
        <path d="M -3.5 -3 Q 0 -6 3.5 -3" fill="none" />
      </g>
    );
  if (d.acc.includes("glassesHalf"))
    return (
      <g stroke={frame} strokeWidth={2} fill={lens}>
        <path d="M -20 1 L -4 1 A 8 6.5 0 0 1 -20 1 Z" />
        <path d="M 4 1 L 20 1 A 8 6.5 0 0 1 4 1 Z" />
        <path d="M -4 1 Q 0 -1 4 1" fill="none" />
      </g>
    );
  if (d.acc.includes("glassesThick") || d.acc.includes("glassesRect") || d.acc.includes("glassesChain"))
    return (
      <g stroke={frame} strokeWidth={d.acc.includes("glassesThick") ? 3.4 : 2} fill={lens}>
        <rect x={-21} y={-9} width={17} height={13} rx={3.5} />
        <rect x={4} y={-9} width={17} height={13} rx={3.5} />
        <path d="M -4 -4 L 4 -4" fill="none" />
        {d.acc.includes("glassesChain") && <path d="M -21 -3 Q -30 14 -26 30 M 21 -3 Q 30 14 26 30" stroke={P.brass} strokeWidth={1.2} fill="none" />}
      </g>
    );
  return null;
}

function FacialHair({ d }: { d: Design }) {
  return (
    <>
      {d.acc.includes("beard") && <path d="M -29 -2 Q -29 32 0 42 Q 29 32 29 -2 L 23 6 Q 20 24 0 28 Q -20 24 -23 6 Z" fill={d.hair2 ?? d.hair} />}
      {d.acc.includes("stubble") && <path d="M -27 6 Q -25 32 0 38 Q 25 32 27 6 Q 18 26 0 28 Q -18 26 -27 6 Z" fill={d.hair} opacity={0.32} />}
      {(d.acc.includes("moustache") || d.acc.includes("beard")) && (
        <path d="M -11 14 Q -5 9 0 12 Q 5 9 11 14 Q 7 18 0 15.5 Q -7 18 -11 14 Z" fill={d.hair2 ?? d.hair} />
      )}
    </>
  );
}

function Head({ d, mood, talking, look }: { d: Design; mood: Mood; talking: boolean; look: number }) {
  const f = MOOD_FACE[mood];
  const thick = d.brows === "thick";
  const browColor = d.hairStyle === "bald" || d.hairStyle === "beanie" ? d.hair2 ?? d.hair : d.hair;
  const lx = look * 4.2;
  return (
    <g>
      <HairBack d={d} />
      <ellipse cx={-29} cy={3} rx={5.5} ry={8} fill={d.skin} />
      <ellipse cx={29} cy={3} rx={5.5} ry={8} fill={d.skin} />
      <ellipse rx={29} ry={35} fill={d.skin} />
      {/* soft side shade gives the head a turn */}
      <path d={look >= 0 ? "M -29 0 A 29 35 0 0 0 -6 34.5 A 32 36 0 0 1 -29 0 Z" : "M 29 0 A 29 35 0 0 1 6 34.5 A 32 36 0 0 0 29 0 Z"} fill={shadeOf} opacity={0.6} />
      {d.acc.includes("earrings") && (
        <g fill={P.brass}>
          <circle cx={-30} cy={13} r={2.6} />
          <circle cx={30} cy={13} r={2.6} />
        </g>
      )}
      <g className="ch-face" style={{ transform: `translateX(${lx}px)` }}>
        {d.acc.includes("freckles") && (
          <g fill="#b0603e" opacity={0.5}>
            {[-17, -13, -15, 13, 17, 15].map((x, i) => (
              <circle key={i} cx={x} cy={8 + (i % 3) * 2} r={1} />
            ))}
          </g>
        )}
        {(mood === "anxious" || mood === "broken" || mood === "relieved" || d.acc.includes("freckles")) && (
          <g fill="#e0705f" opacity={0.28}>
            <ellipse cx={-17} cy={10} rx={6} ry={3.5} />
            <ellipse cx={17} cy={10} rx={6} ry={3.5} />
          </g>
        )}
        {d.acc.includes("wrinkles") && (
          <g stroke={shadeOf} strokeWidth={1.3} fill="none" strokeLinecap="round">
            <path d="M -22 -1 L -26 -3 M -22 2 L -26 3 M 22 -1 L 26 -3 M 22 2 L 26 3" />
            <path d="M -10 -20 Q 0 -22 10 -20" />
          </g>
        )}
        <Eyes kind={f.eyes} skin={d.skin} />
        <g transform={`translate(0 ${f.browY})`} fill={browColor}>
          <rect x={-18} y={-15} width={13} height={thick ? 4.6 : 3} rx={1.5} style={{ transform: `rotate(${f.brow}deg)`, transformOrigin: "-11.5px -13px" }} />
          <rect x={5} y={-15} width={13} height={thick ? 4.6 : 3} rx={1.5} style={{ transform: `rotate(${-f.brow}deg)`, transformOrigin: "11.5px -13px" }} />
        </g>
        <path d="M 1.5 -1 Q 5 8 -1.5 10" stroke="rgba(27,16,40,0.32)" strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <FacialHair d={d} />
        <Mouth kind={f.mouth} d={d} talking={talking} />
        <Glasses d={d} />
      </g>
      <HairFront d={d} />
      {mood === "broken" && (
        <g className="ch-gloom" stroke="#5a7fb8" strokeWidth={2.4} strokeLinecap="round" opacity={0.75}>
          <path d="M -14 -30 L -14 -16 M -5 -33 L -5 -19 M 4 -33 L 4 -19 M 13 -30 L 13 -16" />
        </g>
      )}
      {(mood === "broken" || mood === "shocked") && (
        <g fill="#bfe4f2" stroke="#4f8fae" strokeWidth={1.4}>
          <g className="ch-sweat">
            <path d="M 30 -26 Q 39 -11 30 -5 Q 21 -11 30 -26 Z" />
          </g>
          <g className="ch-sweat-2">
            <path d="M -31 -14 Q -24 -3 -31 2 Q -38 -3 -31 -14 Z" />
          </g>
        </g>
      )}
    </g>
  );
}

// ───────────────────────────── body ─────────────────────────────

function Arm({ d, side, angles, prop }: { d: Design; side: "a" | "b"; angles: [number, number]; prop?: ReactNode }) {
  const sx = (side === "a" ? -1 : 1) * (44 * d.build - 6);
  const robe = d.outfit === "robe";
  const rolled = d.outfit === "flannel";
  const sleeve = d.outfit === "uniform" || d.outfit === "flannel" ? d.under : d.top;
  return (
    <g transform={`translate(${sx} -226)`}>
      <g className="ch-limb" style={{ transform: `rotate(${angles[0]}deg)` }}>
        <g className={side === "b" ? "ch-arm-talk" : undefined}>
          {robe ? (
            <path d="M -13 -2 Q -16 26 -15 54 L 15 54 Q 16 26 13 -2 Q 0 -9 -13 -2 Z" fill={sleeve} />
          ) : (
            <path d="M -10.5 -1 Q -12 26 -10 54 L 10 54 Q 12 26 10.5 -1 Q 0 -7 -10.5 -1 Z" fill={sleeve} />
          )}
          <g transform="translate(0 50)">
            <g className="ch-limb" style={{ transform: `rotate(${angles[1]}deg)` }}>
              {robe ? (
                <path d="M -15 0 L -19 44 Q 0 50 19 44 L 15 0 Z" fill={sleeve} />
              ) : rolled ? (
                <>
                  <path d="M -9 0 L -8 46 L 8 46 L 9 0 Z" fill={d.skin} />
                  <rect x={-11} y={-2} width={22} height={12} rx={4} fill={sleeve} />
                </>
              ) : (
                <path d="M -9.5 0 L -8.5 46 L 8.5 46 L 9.5 0 Z" fill={sleeve} />
              )}
              {!robe && !rolled && <rect x={-9} y={40} width={18} height={6} rx={2} fill={d.outfit === "suit" || d.outfit === "blazer" ? d.under : shadeOf} />}
              <circle cx={0} cy={robe ? 50 : 54} r={9} fill={d.skin} />
              {prop}
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

function Torso({ d, clip }: { d: Design; clip: string }) {
  const b = d.build;
  const sw = 44 * b + (d.outfit === "blazer" ? 4 : 0);
  const hw = 37 * b;
  const long = d.outfit === "robe" ? -6 : null;
  const torso = long
    ? `M ${-sw - 3} -222 Q ${-sw - 3} -238 ${-sw + 12} -238 L ${sw - 12} -238 Q ${sw + 3} -238 ${sw + 3} -222 L ${62 * b} ${long} L ${-62 * b} ${long} Z`
    : d.outfit === "blazer"
      ? `M ${-sw} -224 L ${-sw + 4} -238 L ${sw - 4} -238 L ${sw} -224 L ${hw - 2} -128 L ${-hw + 2} -128 Z`
      : `M ${-sw} -222 Q ${-sw} -237 ${-sw + 13} -237 L ${sw - 13} -237 Q ${sw} -237 ${sw} -222 L ${hw} -128 L ${-hw} -128 Z`;

  const vNeck = (w: number, bottom: number, fill: string) => <path d={`M ${-w} -238 L ${w} -238 L 0 ${bottom} Z`} fill={fill} />;

  return (
    <g>
      <clipPath id={clip}>
        <path d={torso} />
      </clipPath>
      <path d={torso} fill={d.outfit === "uniform" || d.outfit === "flannel" ? d.under : d.top} />
      <g clipPath={`url(#${clip})`}>
        {d.outfit === "flannel" && (
          <g opacity={0.55}>
            {[-60, -40, -20, 0, 20, 40, 60].map((x) => (
              <rect key={x} x={x - 4} y={-240} width={8} height={120} fill={d.accent} />
            ))}
            {[-226, -204, -182, -160, -138].map((y) => (
              <rect key={y} x={-70} y={y} width={140} height={6} fill={d.accent} opacity={0.8} />
            ))}
          </g>
        )}
        {d.outfit === "tweed" && (
          <g fill="rgba(255,240,210,0.16)">
            {Array.from({ length: 36 }, (_, i) => (
              <circle key={i} cx={-48 + (i % 9) * 12 + ((i >> 2) % 2) * 5} cy={-232 + Math.floor(i / 9) * 26} r={1.6} />
            ))}
          </g>
        )}
        {/* torso shade on the side away from the light */}
        <path d={`M ${sw} -240 L ${sw + 20} -240 L ${hw + 20} -100 L ${hw - 10} -100 Z`} fill={shadeOf} />
        <rect x={-80} y={-140} width={160} height={14} fill={shadeOf} opacity={0.5} />
      </g>

      {(d.outfit === "suit" || d.outfit === "tweed") && (
        <>
          {vNeck(14, -170, d.under)}
          <path d="M -14 -238 L -27 -229 L -5 -168 Z" fill={shadeOf} />
          <path d="M 14 -238 L 27 -229 L 5 -168 Z" fill={shadeOf} />
          <circle cx={0} cy={-156} r={2.6} fill={shadeOf} />
          <circle cx={0} cy={-142} r={2.6} fill={shadeOf} />
        </>
      )}
      {d.outfit === "blazer" && (
        <>
          {vNeck(12, -186, d.under)}
          <path d="M -12 -238 L -30 -226 L -3 -184 Z" fill={shadeOf} />
          <path d="M 12 -238 L 30 -226 L 3 -184 Z" fill={shadeOf} />
          <rect x={-hw + 6} y={-146} width={2 * hw - 12} height={6} fill={shadeOf} />
        </>
      )}
      {d.outfit === "cardigan" && (
        <>
          {vNeck(17, -150, d.under)}
          <path d="M -17 -238 L -9 -226 L 0 -238 Z M 17 -238 L 9 -226 L 0 -238 Z" fill="#fff" opacity={0.8} />
          {[-196, -176, -156, -138].map((y) => (
            <circle key={y} cx={-4 - (y + 238) * 0.05} cy={y} r={2.4} fill={shadeOf} />
          ))}
        </>
      )}
      {d.outfit === "sweater" && (
        <>
          <path d="M -15 -238 Q 0 -222 15 -238 Z" fill={d.under} />
          <rect x={-hw} y={-138} width={2 * hw} height={10} fill={shadeOf} />
        </>
      )}
      {d.outfit === "zip" && (
        <>
          <rect x={-15} y={-246} width={30} height={14} rx={4} fill={d.top} />
          <rect x={-15} y={-246} width={30} height={14} rx={4} fill={shadeOf} opacity={0.5} />
          <line x1={0} y1={-232} x2={0} y2={-128} stroke={P.inkSoft} strokeWidth={2} />
          <rect x={-sw} y={-206} width={2 * sw} height={9} fill={d.accent} clipPath={`url(#${clip})`} />
        </>
      )}
      {d.outfit === "flannel" && (
        <>
          <path d="M -13 -238 L 13 -238 L 0 -214 Z" fill={d.skin} />
          <path d="M -13 -238 L -20 -232 L -2 -212 Z M 13 -238 L 20 -232 L 2 -212 Z" fill={d.under} />
          <path d="M -13 -238 L -20 -232 L -2 -212 Z M 13 -238 L 20 -232 L 2 -212 Z" fill={shadeOf} />
        </>
      )}
      {d.outfit === "uniform" && (
        <>
          <path d="M -12 -238 L 12 -238 L 0 -222 Z" fill={d.top} />
          <rect x={-sw + 2} y={-238} width={22} height={7} rx={2} fill={d.top} />
          <rect x={sw - 24} y={-238} width={22} height={7} rx={2} fill={d.top} />
          <rect x={-31} y={-212} width={20} height={11} rx={2} fill={shadeOf} />
          <rect x={11} y={-212} width={20} height={11} rx={2} fill={shadeOf} />
          <rect x={-hw} y={-140} width={2 * hw} height={10} fill={d.top} />
          <rect x={-6} y={-141} width={12} height={12} rx={2} fill={P.brass} />
        </>
      )}
      {d.outfit === "robe" && (
        <>
          <path d="M -16 -238 L 16 -238 L 0 -214 Z" fill={d.under} />
          <rect x={-7} y={-226} width={6} height={22} rx={1} fill="#fff" />
          <rect x={1} y={-226} width={6} height={22} rx={1} fill="#fff" />
          <path d={`M -16 -238 L -6 -110 M 16 -238 L 6 -110`} stroke={shadeOf} strokeWidth={4} />
          <path d={`M -2 -200 L -2 -10 M 2 -200 L 2 -10`} stroke={shadeOf} strokeWidth={1.5} />
        </>
      )}

      {d.acc.includes("tie") && (
        <g>
          <path d="M -5 -232 L 5 -232 L 7 -178 L 0 -168 L -7 -178 Z" fill={d.accent} />
          <path d="M -6 -238 L 6 -238 L 4 -229 L -4 -229 Z" fill={d.accent} />
          <path d="M -6 -238 L 6 -238 L 4 -229 L -4 -229 Z" fill={shadeOf} />
        </g>
      )}
      {d.acc.includes("bowtie") && (
        <path d="M -14 -234 L -2 -229 L 2 -229 L 14 -234 L 14 -222 L 2 -227 L -2 -227 L -14 -222 Z" fill={d.accent} />
      )}
      {d.acc.includes("scarf") && (
        <g fill={d.accent}>
          <path d="M -22 -244 Q 0 -230 22 -244 L 24 -232 Q 0 -218 -24 -232 Z" />
          <path d="M 6 -232 L 16 -232 L 18 -190 L 8 -192 Z" />
        </g>
      )}
      {d.acc.includes("pearls") && (
        <g fill="#f6f0e6">
          {[-14, -10, -5, 0, 5, 10, 14].map((x, i) => (
            <circle key={i} cx={x} cy={-224 - Math.abs(x) * 0.42} r={2.4} />
          ))}
        </g>
      )}
      {d.acc.includes("brooch") && <circle cx={-26} cy={-210} r={4.5} fill={P.brass} stroke={P.brassDark} strokeWidth={1.4} />}
      {d.acc.includes("badge") && (
        <path d="M -27 -204 L -15 -204 L -15 -194 Q -21 -186 -21 -186 Q -27 -194 -27 -194 Z" fill={P.brass} stroke={P.brassDark} strokeWidth={1} />
      )}
      {d.acc.includes("pocketSquare") && <path d={`M ${18 * b} -204 L ${30 * b} -204 L ${26 * b} -198 L ${21 * b} -199 Z`} fill={d.accent} />}
      {d.acc.includes("lanyard") && (
        <g>
          <path d="M -10 -238 L 0 -196 L 10 -238" stroke={d.accent} strokeWidth={3} fill="none" />
          <rect x={-8} y={-198} width={16} height={20} rx={2} fill="#fff" />
          <rect x={-5} y={-194} width={10} height={4} fill={d.accent} />
        </g>
      )}
    </g>
  );
}

function Legs({ d }: { d: Design }) {
  const b = d.build;
  const lx = 15 * b;
  if (d.outfit === "robe") {
    return (
      <g>
        <ellipse cx={-14} cy={-3} rx={14} ry={6} fill={d.shoes} />
        <ellipse cx={14} cy={-3} rx={14} ry={6} fill={d.shoes} />
      </g>
    );
  }
  const legFill = d.skirt ? d.skin : d.bottom;
  const leg = (x: number, cls: string) => (
    <g transform={`translate(${x} -128)`} key={cls}>
      <g className={`ch-leg ${cls}`}>
        <path d={d.skirt ? "M -7 0 L -6.5 114 L 6.5 114 L 7 0 Z" : `M ${-12 * b} 0 L ${-10.5 * b} 114 L ${10.5 * b} 114 L ${12 * b} 0 Z`} fill={legFill} />
        <path d={`M ${x < 0 ? -15 : -10} 112 Q ${x < 0 ? -16 : -11} 124 ${x < 0 ? -2 : 3} 124 L ${x < 0 ? 10 : 15} 124 Q ${x < 0 ? 12 : 16} 116 ${x < 0 ? 8 : 10} 110 Z`} fill={d.shoes} />
      </g>
    </g>
  );
  return (
    <g>
      {leg(-lx, "ch-leg-a")}
      {leg(lx, "ch-leg-b")}
      {d.skirt && <path d={`M ${-37 * b} -132 L ${-42 * b} -60 L ${42 * b} -60 L ${37 * b} -132 Z`} fill={d.bottom} />}
      {!d.skirt && <path d={`M ${-37 * b} -132 L ${37 * b} -132 L ${33 * b} -112 L ${-33 * b} -112 Z`} fill={d.bottom} />}
    </g>
  );
}

function GavelProp() {
  return (
    <g transform="translate(0 54) rotate(90)">
      <rect x={-3} y={-4} width={44} height={7} rx={3} fill={P.woodHi} />
      <rect x={34} y={-15} width={20} height={30} rx={5} fill={P.wood} />
      <rect x={34} y={-15} width={20} height={6} rx={2} fill={P.brass} />
      <rect x={34} y={9} width={20} height={6} rx={2} fill={P.brass} />
    </g>
  );
}

function ClipboardProp() {
  return (
    <g transform="translate(-6 40) rotate(-8)">
      <rect x={-2} y={-6} width={34} height={44} rx={3} fill={P.woodLight} />
      <rect x={2} y={0} width={26} height={34} fill={P.paper} />
      <rect x={9} y={-9} width={12} height={6} rx={2} fill={P.brass} />
      {[8, 14, 20, 26].map((y) => (
        <line key={y} x1={6} x2={24} y1={y} y2={y} stroke="#9aa" strokeWidth={1.4} />
      ))}
    </g>
  );
}

export interface CharacterProps {
  design: Design;
  seed: string;
  mood?: Mood;
  pose?: Pose;
  talking?: boolean;
  /** -1 looks to the viewer's left, +1 to the right, in the character's own (unflipped) frame. */
  look?: number;
  walking?: boolean;
  className?: string;
}

export const Character = memo(function Character({
  design: d,
  seed,
  mood = "neutral",
  pose = "rest",
  talking = false,
  look = 0,
  walking = false,
  className,
}: CharacterProps) {
  const clip = useId().replace(/:/g, "");
  const p = POSES[mood === "broken" && pose === "rest" ? "slump" : pose];
  const slump = mood === "broken" || mood === "sad";
  const cls = ["ch", talking && "ch-talking", walking && "ch-walking", slump && "ch-slumped", mood === "shocked" && "ch-shocked", className].filter(Boolean).join(" ");
  return (
    <g className={cls} style={idleVars(seed)}>
      <ellipse cx={0} cy={2} rx={48 * d.build} ry={9} fill="rgba(20,10,30,0.35)" className="ch-shadow" />
      <g transform={`scale(${d.height})`}>
        <Legs d={d} />
        <g className="ch-upper">
          <g className="ch-breathe">
            <g className="ch-slump">
              <Torso d={d} clip={`t${clip}`} />
              <rect x={-9} y={-256} width={18} height={24} fill={d.skin} />
              <rect x={-9} y={-252} width={18} height={9} fill={shadeOf} />
              <g transform="translate(0 -249)">
                <g className="ch-head">
                  <g className="ch-head-tilt" style={{ transform: `translateX(${look * 1.8}px)` }}>
                    <g transform="translate(0 -35)">
                      <Head d={d} mood={mood} talking={talking} look={look} />
                    </g>
                  </g>
                </g>
              </g>
              <Arm d={d} side="a" angles={p.a} prop={d.acc.includes("clipboard") ? <ClipboardProp /> : undefined} />
              <Arm d={d} side="b" angles={p.b} prop={d.acc.includes("gavel") ? <GavelProp /> : undefined} />
            </g>
          </g>
        </g>
      </g>
    </g>
  );
});

/** Head-and-shoulders portrait for cards, the HUD and the jury room. */
export function Portrait({
  design,
  seed,
  mood = "neutral",
  size = 96,
  bg,
  className,
  title,
}: {
  design: Design;
  seed: string;
  mood?: Mood;
  size?: number;
  bg?: string;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={`portrait ${className ?? ""}`}
      viewBox="-72 -364 144 144"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {bg && <rect x={-70} y={-350} width={140} height={140} fill={bg} />}
      <g transform="translate(0 6)">
        <Character design={design} seed={seed} mood={mood} />
      </g>
    </svg>
  );
}
