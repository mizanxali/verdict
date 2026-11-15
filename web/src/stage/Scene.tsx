/**
 * The courtroom, as layered flat illustration. Each export is one depth layer; Stage.tsx
 * interleaves them with the characters so furniture hides whoever stands behind it.
 */
import { P } from "../art/palette";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function SceneDefs() {
  return (
    <defs>
      <linearGradient id="g-wall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#24344c" />
        <stop offset="0.7" stopColor={P.wall} />
        <stop offset="1" stopColor="#33496a" />
      </linearGradient>
      <linearGradient id="g-floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4a2f22" />
        <stop offset="1" stopColor="#6b4630" />
      </linearGradient>
      <linearGradient id="g-window" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f6e2b0" />
        <stop offset="0.55" stopColor="#d7d6c0" />
        <stop offset="1" stopColor="#9fbcc8" />
      </linearGradient>
      <linearGradient id="g-shaft" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffeec6" stopOpacity="0.22" />
        <stop offset="1" stopColor="#ffeec6" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="g-lamp">
        <stop offset="0" stopColor="#ffe3a0" stopOpacity="0.55" />
        <stop offset="1" stopColor="#ffe3a0" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="g-pool">
        <stop offset="0" stopColor="#ffe9bd" stopOpacity="0.28" />
        <stop offset="1" stopColor="#ffe9bd" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="g-wood-top" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={P.woodHi} />
        <stop offset="1" stopColor={P.woodLight} />
      </linearGradient>
      <linearGradient id="g-doorway" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3c2a20" />
        <stop offset="1" stopColor="#8a5f3a" />
      </linearGradient>
    </defs>
  );
}

function Window({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const r = w / 2;
  const frame = `M ${x} ${y + h} L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
  return (
    <g>
      <path d={`M ${x - 10} ${y + h + 6} L ${x - 10} ${y + r} A ${r + 10} ${r + 10} 0 0 1 ${x + w + 10} ${y + r} L ${x + w + 10} ${y + h + 6} Z`} fill={P.woodDark} />
      <path d={frame} fill="url(#g-window)" />
      {/* distant rooftops through the glass */}
      <path d={`M ${x} ${y + h * 0.78} L ${x + w * 0.2} ${y + h * 0.7} L ${x + w * 0.35} ${y + h * 0.74} L ${x + w * 0.5} ${y + h * 0.62} L ${x + w * 0.62} ${y + h * 0.7} L ${x + w * 0.8} ${y + h * 0.66} L ${x + w} ${y + h * 0.72} L ${x + w} ${y + h} L ${x} ${y + h} Z`} fill="#7e98a8" opacity={0.7} />
      <g stroke={P.woodDark} strokeWidth={6}>
        <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} />
        {range(3).map((i) => (
          <line key={i} x1={x} x2={x + w} y1={y + r + ((h - r) * (i + 1)) / 4} y2={y + r + ((h - r) * (i + 1)) / 4} />
        ))}
      </g>
      <rect x={x - 18} y={y + h + 2} width={w + 36} height={12} rx={3} fill={P.woodLight} />
    </g>
  );
}

function Sconce({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y - 6} r={90} fill="url(#g-lamp)" className="lamp-glow" />
      <rect x={x - 4} y={y} width={8} height={34} fill={P.brassDark} />
      <path d={`M ${x - 18} ${y + 30} L ${x + 18} ${y + 30} L ${x + 10} ${y + 40} L ${x - 10} ${y + 40} Z`} fill={P.brass} />
      <path d={`M ${x - 16} ${y - 2} L ${x + 16} ${y - 2} L ${x + 22} ${y - 30} L ${x - 22} ${y - 30} Z`} fill="#f7dc9a" />
      <path d={`M ${x - 16} ${y - 2} L ${x + 16} ${y - 2} L ${x + 22} ${y - 30} L ${x - 22} ${y - 30} Z`} fill="none" stroke={P.brassDark} strokeWidth={3} />
    </g>
  );
}

function Seal({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={62} fill={P.brassDark} />
      <circle r={56} fill={P.brass} />
      <circle r={44} fill="#2a3d5c" />
      <circle r={56} fill="none" stroke="#f4d58a" strokeWidth={2} strokeDasharray="3 5" />
      {/* the alder tree of Aldermere over three waves */}
      <rect x={-3.5} y={-8} width={7} height={30} fill={P.brass} />
      <path d="M 0 -34 C 18 -34 28 -20 22 -8 C 30 -2 22 10 10 6 C 6 12 -6 12 -10 6 C -22 10 -30 -2 -22 -8 C -28 -20 -18 -34 0 -34 Z" fill={P.brass} />
      <path d="M -26 26 Q -19 21 -13 26 Q -6 31 0 26 Q 6 21 13 26 Q 19 31 26 26" stroke={P.brass} strokeWidth={3.5} fill="none" />
      <path d="M -22 34 Q -15 29 -9 34 Q -2 39 4 34 Q 10 29 16 34" stroke={P.brass} strokeWidth={3} fill="none" opacity={0.7} />
    </g>
  );
}

function Clock({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={30} fill={P.woodDark} />
      <circle r={25} fill={P.cream} />
      {range(12).map((i) => (
        <rect key={i} x={-1.2} y={-23} width={2.4} height={i % 3 === 0 ? 7 : 4} fill={P.ink} transform={`rotate(${i * 30})`} />
      ))}
      <g className="clock-hand-m">
        <rect x={-1.6} y={-20} width={3.2} height={22} rx={1.5} fill={P.ink} />
      </g>
      <g className="clock-hand-h">
        <rect x={-2} y={-13} width={4} height={15} rx={2} fill={P.ink} transform="rotate(320)" />
      </g>
      <circle r={3} fill={P.red} />
    </g>
  );
}

export function BackWall({ doorOpen }: { doorOpen: boolean }) {
  return (
    <g>
      <rect x={0} y={0} width={1600} height={530} fill="url(#g-wall)" />
      {/* tall wall panels */}
      {[30, 410, 1060, 1490].map((x) => (
        <rect key={x} x={x} y={40} width={80} height={330} rx={4} fill={P.wallLight} opacity={0.35} />
      ))}
      {/* crown moulding */}
      <rect x={0} y={0} width={1600} height={22} fill={P.woodDark} />
      <rect x={0} y={22} width={1600} height={6} fill={P.woodMid} />

      <Window x={160} y={62} w={150} h={268} />
      <Window x={1172} y={62} w={130} h={200} />

      {/* light shafts from the left window across the floor */}
      <path d="M 160 330 L 310 330 L 640 900 L 260 900 Z" fill="url(#g-shaft)" className="shaft" />
      <path d="M 1172 262 L 1302 262 L 1460 900 L 1180 900 Z" fill="url(#g-shaft)" className="shaft" opacity={0.6} />

      {/* the bench's carved backdrop */}
      <path d="M 560 380 L 560 70 L 800 30 L 1040 70 L 1040 380 Z" fill={P.woodDark} />
      <path d="M 584 380 L 584 86 L 800 52 L 1016 86 L 1016 380 Z" fill={P.panel} />
      {[612, 830].map((x) => (
        <rect key={x} x={x} y={180} width={158} height={180} rx={6} fill={P.woodDark} opacity={0.45} />
      ))}
      <Seal x={800} y={124} />
      <Sconce x={520} y={170} />
      <Sconce x={1080} y={170} />

      {/* wainscot */}
      <rect x={0} y={370} width={1600} height={160} fill={P.wood} />
      <rect x={0} y={370} width={1600} height={10} fill={P.woodLight} />
      {range(16).map((i) => (
        <rect key={i} x={14 + i * 100} y={392} width={80} height={118} rx={4} fill={P.woodDark} opacity={0.35} />
      ))}

      {/* the door the witnesses use */}
      <g>
        <rect x={1318} y={238} width={168} height={292} fill={P.woodDark} />
        <rect x={1310} y={230} width={184} height={18} rx={3} fill={P.woodLight} />
        <rect x={1340} y={262} width={124} height={268} fill="url(#g-doorway)" />
        <path d="M 1340 530 L 1464 530 L 1520 600 L 1300 600 Z" fill="#ffe2a8" opacity={doorOpen ? 0.2 : 0} className="door-spill" />
        <Clock x={1402} y={140} />
        <rect x={1360} y={204} width={84} height={22} rx={3} fill={P.ink} opacity={0.75} />
        <text x={1402} y={220} textAnchor="middle" className="svg-sign">
          WITNESSES
        </text>
      </g>

      {/* floor */}
      <rect x={0} y={530} width={1600} height={370} fill="url(#g-floor)" />
      <g stroke={P.floorDark} strokeWidth={3} opacity={0.7}>
        {range(26).map((i) => {
          const xb = -1200 + i * 160;
          const t = (530 - 150) / (900 - 150);
          const xt = 800 + (xb - 800) * t;
          return <line key={i} x1={xt} y1={530} x2={xb} y2={900} />;
        })}
        {[560, 600, 652, 718, 800].map((y) => (
          <line key={y} x1={0} x2={1600} y1={y} y2={y} strokeWidth={2} opacity={0.6} />
        ))}
      </g>
      {/* carpet runner from the gallery to the bench */}
      <path d="M 740 530 L 860 530 L 960 900 L 640 900 Z" fill="#6e2a2e" />
      <path d="M 752 530 L 848 530 L 940 900 L 660 900 Z" fill="none" stroke={P.brass} strokeWidth={3} opacity={0.5} />
      <ellipse cx={420} cy={720} rx={280} ry={90} fill="url(#g-pool)" />
      <rect x={0} y={526} width={1600} height={8} fill={P.woodDark} />
    </g>
  );
}

/** The door leaf, drawn above the walkers' doorway so it can swing closed in front of them. */
export function DoorLeaf({ open }: { open: boolean }) {
  return (
    <g transform="translate(1464 262)">
      <g className={`door-leaf${open ? " open" : ""}`}>
        <rect x={-124} y={0} width={124} height={268} fill={P.woodMid} />
        <rect x={-110} y={16} width={96} height={98} rx={4} fill={P.wood} />
        <rect x={-110} y={130} width={96} height={122} rx={4} fill={P.wood} />
        <circle cx={-62} cy={64} r={22} fill="#c3d6dc" stroke={P.woodDark} strokeWidth={5} />
        <circle cx={-110} cy={150} r={6} fill={P.brass} />
        <rect x={-124} y={0} width={8} height={268} fill={P.shade} />
      </g>
    </g>
  );
}

export function Bench({ judgeName }: { judgeName: string }) {
  return (
    <g>
      <rect x={570} y={290} width={460} height={22} rx={4} fill="url(#g-wood-top)" />
      <rect x={576} y={312} width={448} height={218} fill={P.wood} />
      <rect x={576} y={312} width={448} height={10} fill={P.shade} />
      {[598, 744, 890].map((x) => (
        <g key={x}>
          <rect x={x} y={340} width={112} height={156} rx={6} fill={P.woodMid} />
          <rect x={x + 10} y={350} width={92} height={136} rx={4} fill={P.wood} />
        </g>
      ))}
      <rect x={576} y={512} width={448} height={18} fill={P.woodDark} />
      <rect x={740} y={296} width={120} height={14} rx={2} fill={P.brass} />
      <text x={800} y={307} textAnchor="middle" className="svg-plate">
        {judgeName.toUpperCase()}
      </text>
      {/* sound block */}
      <ellipse cx={890} cy={292} rx={22} ry={6} fill={P.woodDark} />
      <rect x={868} y={284} width={44} height={8} rx={3} fill={P.woodMid} />
    </g>
  );
}

export function ClerkDesk() {
  return (
    <g>
      <rect x={424} y={408} width={182} height={16} rx={3} fill="url(#g-wood-top)" />
      <rect x={430} y={424} width={170} height={128} fill={P.woodMid} />
      <rect x={444} y={438} width={142} height={76} rx={4} fill={P.wood} />
      {/* banker's lamp */}
      <rect x={570} y={380} width={4} height={28} fill={P.brassDark} />
      <path d="M 552 384 Q 572 366 592 384 Z" fill="#2f7a55" />
      <ellipse cx={572} cy={390} rx={40} ry={18} fill="url(#g-lamp)" />
      <rect x={440} y={398} width={56} height={10} rx={1} fill={P.paper} transform="rotate(-4 468 403)" />
    </g>
  );
}

export function WitnessStand({ name }: { name: string | null }) {
  return (
    <g>
      <rect x={1052} y={518} width={196} height={14} fill={P.woodDark} />
      <rect x={1050} y={392} width={200} height={16} rx={4} fill="url(#g-wood-top)" />
      <rect x={1058} y={408} width={184} height={112} fill={P.wood} />
      <rect x={1072} y={422} width={156} height={84} rx={5} fill={P.woodMid} />
      <rect x={1058} y={408} width={184} height={8} fill={P.shade} />
      {/* microphone */}
      <path d="M 1222 392 Q 1222 362 1206 350" stroke={P.ink} strokeWidth={3.5} fill="none" />
      <rect x={1196} y={340} width={14} height={18} rx={6} fill="#3a3540" transform="rotate(-30 1203 349)" />
      <rect x={1092} y={448} width={116} height={26} rx={3} fill={P.brass} />
      <text x={1150} y={466} textAnchor="middle" className="svg-plate stand-plate">
        {name ? name.toUpperCase() : "WITNESS"}
      </text>
    </g>
  );
}

export function JuryBack() {
  return (
    <g>
      <rect x={10} y={360} width={414} height={14} rx={3} fill="url(#g-wood-top)" />
      <rect x={16} y={374} width={402} height={156} fill={P.woodDark} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={46 + i * 120} y={394} width={92} height={70} rx={8} fill="#5c2b2b" />
      ))}
    </g>
  );
}

/** The raised back tier's front rail: hides the back row below the chest. */
export function JuryMid() {
  return (
    <g>
      <rect x={10} y={404} width={414} height={12} rx={3} fill="url(#g-wood-top)" />
      <rect x={16} y={416} width={402} height={114} fill={P.wood} />
      <rect x={16} y={416} width={402} height={8} fill={P.shade} />
    </g>
  );
}

export function JuryFront() {
  return (
    <g>
      <path d="M 0 452 L 436 452 L 452 470 L 0 470 Z" fill="url(#g-wood-top)" />
      <rect x={0} y={470} width={452} height={150} fill={P.wood} />
      {range(4).map((i) => (
        <g key={i}>
          <rect x={18 + i * 108} y={490} width={92} height={110} rx={6} fill={P.woodMid} />
          <rect x={28 + i * 108} y={500} width={72} height={90} rx={4} fill={P.wood} />
        </g>
      ))}
      <rect x={0} y={470} width={452} height={8} fill={P.shade} />
      <rect x={0} y={612} width={460} height={10} fill={P.woodDark} />
      <rect x={140} y={548} width={170} height={22} rx={3} fill={P.ink} opacity={0.75} />
      <text x={225} y={564} textAnchor="middle" className="svg-sign">
        JURY
      </text>
    </g>
  );
}

export function CounselTable({ side }: { side: "defence" | "prosecution" }) {
  const x0 = side === "defence" ? 292 : 880;
  const w = 486;
  return (
    <g>
      <path d={`M ${x0 + 14} 686 L ${x0 + w - 14} 686 L ${x0 + w} 708 L ${x0} 708 Z`} fill="url(#g-wood-top)" />
      <rect x={x0} y={708} width={w} height={106} fill={P.wood} />
      <rect x={x0} y={708} width={w} height={10} fill={P.shade} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={x0 + 22 + i * 154} y={728} width={134} height={60} rx={5} fill={P.woodMid} />
      ))}
      {side === "defence" ? (
        <g>
          <rect x={x0 + 300} y={682} width={60} height={12} fill="#f2d65a" transform={`rotate(-6 ${x0 + 330} 688)`} />
          <rect x={x0 + 120} y={684} width={84} height={10} fill={P.paper} transform={`rotate(3 ${x0 + 160} 689)`} />
          <rect x={x0 + 216} y={680} width={60} height={14} rx={2} fill="#c9a36a" />
        </g>
      ) : (
        <g>
          <rect x={x0 + 70} y={672} width={80} height={22} rx={2} fill="#2f4a7a" />
          <rect x={x0 + 76} y={668} width={70} height={8} fill={P.paper} />
          <rect x={x0 + 300} y={684} width={84} height={10} fill={P.paper} transform={`rotate(-3 ${x0 + 340} 689)`} />
          <rect x={x0 + 400} y={660} width={14} height={32} rx={5} fill="rgba(190,220,235,0.6)" />
        </g>
      )}
      <rect x={x0 + w / 2 - 70} y={748} width={140} height={22} rx={3} fill={P.ink} opacity={0.6} />
      <text x={x0 + w / 2} y={764} textAnchor="middle" className="svg-sign">
        {side === "defence" ? "DEFENCE" : "PROSECUTION"}
      </text>
    </g>
  );
}

export function GalleryRail() {
  return (
    <g>
      <rect x={0} y={812} width={1600} height={88} fill="#1e1219" />
      {range(41).map((i) => (
        <rect key={i} x={i * 40 - 2} y={834} width={18} height={66} rx={6} fill="#2e1c1d" />
      ))}
      <rect x={0} y={808} width={1600} height={26} rx={4} fill="#3b2219" />
      <rect x={0} y={808} width={1600} height={7} fill="#5b3424" />
      {/* the gate in the rail */}
      <rect x={770} y={800} width={60} height={34} rx={4} fill="#2e1c1d" />
    </g>
  );
}
