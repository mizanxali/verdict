/** One-shot stage effects, each mounted with the beat that causes it. */
import type { EventTag, ObjectionType, RecordEntry } from "../../../src/shared/types";
import { ART } from "../art/assets";
import { objectionName, type CaseInfo } from "../labels";
import { headOf, SPOTS } from "./layout";
import type { Beat } from "../usePresenter";

export function groundFromText(text: string, info: CaseInfo): string {
  const m = text.match(/:\s*(.+?)\.?$/);
  if (m) return m[1]!;
  return info.rules.objections.find((o) => text.toLowerCase().includes(o.name.toLowerCase()))?.name ?? "";
}

export function ObjectionShout({ beat, info }: { beat: Beat; info: CaseInfo }) {
  const side = beat.speaker.kind === "player" ? "defence" : "prosecution";
  return (
    <div className={`shout shout-${side}`} aria-hidden>
      <div className="shout-band">
        <span className="shout-word">Objection!</span>
        <span className="shout-ground">{groundFromText(beat.text, info)}</span>
      </div>
      <div className="shout-flash" />
    </div>
  );
}

export function rulingOf(tags: EventTag[]): { sustained: boolean; ground: ObjectionType; by: "defence" | "prosecution" } | null {
  for (const t of tags) {
    if (t.type === "objection_sustained") return { sustained: true, ground: t.ground, by: t.by };
    if (t.type === "objection_overruled") return { sustained: false, ground: t.ground, by: t.by };
  }
  return null;
}

export function RulingStamp({ beat, info, struck }: { beat: Beat; info: CaseInfo; struck: RecordEntry | null }) {
  const r = rulingOf(beat.tags);
  if (!r) return null;
  return (
    <div className="ruling-fx" aria-hidden>
      <img className="ruling-gavel" src={ART.gavel} alt="" draggable={false} />
      <div className="gavel-rings">
        <i />
        <i />
        <i />
      </div>
      <div className={`stamp ${r.sustained ? "stamp-sustained" : "stamp-overruled"}`}>
        <span className="stamp-word">{r.sustained ? "Sustained" : "Overruled"}</span>
        <span className="stamp-sub">{objectionName(r.ground, info)}</span>
      </div>
      {r.sustained && struck && (
        <div className="struck-strip">
          <span className="struck-label">Struck from the record</span>
          <span className="struck-text">
            <span>“{struck.text.length > 110 ? `${struck.text.slice(0, 108)}…` : struck.text}”</span>
            <i className="struck-line" />
          </span>
        </div>
      )}
    </div>
  );
}

/** Fracture lines, relative to the point they break from. */
const CRACKS = [
  "M 0 0 L -70 -54 L -128 -40 L -210 -104 L -260 -96",
  "M 0 0 L 84 -46 L 128 -24 L 236 -92",
  "M 0 0 L 30 72 L 6 118 L 44 196",
  "M 0 0 L -80 46 L -122 38 L -190 92",
  "M 0 0 L -8 -82 L 20 -124 L 4 -196",
  "M 0 0 L 92 34 L 150 22 L 214 70",
];

export function CrackBurst({ beat }: { beat: Beat }) {
  const cracks = beat.tags.filter((t): t is Extract<EventTag, { type: "lie_cracked" }> => t.type === "lie_cracked");
  if (!cracks.length) return null;
  const byDefence = cracks.some((c) => c.by === "defence");
  // the fracture radiates from the witness's face
  const h = headOf(SPOTS.stand);
  const c = { x: h.x, y: h.y + 34 };
  return (
    <div className={`crack-fx ${byDefence ? "by-defence" : "by-prosecution"}`} aria-hidden style={{ ["--cx" as string]: `${c.x}px`, ["--cy" as string]: `${c.y}px` }}>
      <div className="crack-flash" />
      <svg className="crack-lines" viewBox="0 0 1600 900" width={1600} height={900}>
        {CRACKS.map((d, i) => (
          <path key={i} d={d} transform={`translate(${c.x} ${c.y})`} style={{ animationDelay: `${i * 40}ms` }} />
        ))}
      </svg>
      <div className="crack-card">
        <img className="crack-wax" src={ART.wax} alt="" draggable={false} />
        <span className="crack-kicker">{byDefence ? "Contradiction exposed" : "The prosecution exposes"}</span>
        {cracks.map((c) => (
          <span key={c.lieId} className="crack-label">
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
