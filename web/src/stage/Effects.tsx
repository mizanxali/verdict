/** One-shot stage effects, each mounted with the beat that causes it. */
import type { EventTag, ObjectionType, RecordEntry } from "../../../src/shared/types";
import { objectionName, type CaseInfo } from "../labels";
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

export function CrackBurst({ beat }: { beat: Beat }) {
  const cracks = beat.tags.filter((t): t is Extract<EventTag, { type: "lie_cracked" }> => t.type === "lie_cracked");
  if (!cracks.length) return null;
  const byDefence = cracks.some((c) => c.by === "defence");
  return (
    <div className={`crack-fx ${byDefence ? "by-defence" : "by-prosecution"}`} aria-hidden>
      <div className="crack-flash" />
      <svg className="crack-lines" viewBox="0 0 1600 900" width={1600} height={900}>
        {[
          "M 1150 300 L 1060 230 L 990 250 L 900 170",
          "M 1150 300 L 1250 240 L 1300 270 L 1420 190",
          "M 1150 300 L 1190 390 L 1160 450 L 1210 560",
          "M 1150 300 L 1060 360 L 1010 350 L 940 420",
          "M 1150 300 L 1140 200 L 1170 150 L 1150 70",
        ].map((d, i) => (
          <path key={i} d={d} style={{ animationDelay: `${i * 40}ms` }} />
        ))}
      </svg>
      <div className="crack-card">
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
