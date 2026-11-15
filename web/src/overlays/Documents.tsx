/**
 * Exhibits rendered as the documents they are. One small parser turns the plain exhibit
 * text into fields, log rows and prose; the exhibit's kind picks the paper it is printed on.
 */
import type { Exhibit } from "../../../src/shared/types";
import { exhibitArt } from "../art/assets";

type Block = { t: "fields"; rows: [string, string][] } | { t: "rows"; rows: string[][] } | { t: "prose"; lines: string[] };

const FIELD = /^([A-Z][A-Za-z0-9 .'’/()&-]{1,34}):\s+(.+)$/;
const ROW = /^\d[\d/:. A-Za-z]*\S\s{2,}\S/;

export function parseDoc(text: string): Block[] {
  const out: Block[] = [];
  const push = (b: Block) => {
    const last = out[out.length - 1];
    if (last && last.t === b.t && b.t !== "prose") {
      if (last.t === "fields" && b.t === "fields") last.rows.push(...b.rows);
      else if (last.t === "rows" && b.t === "rows") last.rows.push(...b.rows);
      return;
    }
    out.push(b);
  };
  for (const para of text.split(/\n\s*\n/)) {
    let prose: string[] = [];
    const flush = () => {
      if (prose.length) push({ t: "prose", lines: prose });
      prose = [];
    };
    for (const raw of para.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (ROW.test(line)) {
        flush();
        push({ t: "rows", rows: [line.trim().split(/\s{2,}/)] });
        continue;
      }
      const f = line.match(FIELD);
      if (f && !line.startsWith('"') && f[1]!.split(" ").length <= 4) {
        flush();
        push({ t: "fields", rows: [[f[1]!, f[2]!]] });
        continue;
      }
      prose.push(line);
    }
    flush();
  }
  return out;
}

export type DocSkin = "statement" | "photo" | "log" | "logbook" | "email" | "medical" | "insurance" | "ticket" | "generic";

export function skinOf(ex: Exhibit): DocSkin {
  const k = ex.kind.toLowerCase();
  if (k.includes("statement")) return "statement";
  if (k.includes("photo") || k.includes("cctv")) return "photo";
  if (k.includes("maintenance")) return "logbook";
  if (k.includes("log")) return "log";
  if (k.includes("email") || k.includes("letter")) return "email";
  if (k.includes("medical") || k.includes("clinic")) return "medical";
  if (k.includes("insurance") || k.includes("policy") || k.includes("contract")) return "insurance";
  if (k.includes("parking") || k.includes("ticket") || k.includes("receipt")) return "ticket";
  return "generic";
}

/** The exhibit as a rendered object: a statement, a CCTV print, a clipboard log... */
export function ExhibitThumb({ skin, className }: { skin: DocSkin; className?: string }) {
  return <img className={`ex-thumb ${className ?? ""}`} src={exhibitArt(skin)} alt="" draggable={false} decoding="async" />;
}

export function KindGlyph({ skin }: { skin: DocSkin }) {
  const p = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (skin) {
    case "photo":
      return (
        <svg {...p} aria-hidden>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <circle cx="12" cy="12.5" r="3.5" />
          <path d="M8 6l1.5-2h5L16 6" />
        </svg>
      );
    case "log":
    case "logbook":
      return (
        <svg {...p} aria-hidden>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    case "email":
      return (
        <svg {...p} aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 7l9 6 9-6" />
        </svg>
      );
    case "medical":
      return (
        <svg {...p} aria-hidden>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M12 8v6M9 11h6" />
        </svg>
      );
    case "ticket":
      return (
        <svg {...p} aria-hidden>
          <path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4Z" />
          <path d="M14 6v12" strokeDasharray="2 2" />
        </svg>
      );
    case "insurance":
      return (
        <svg {...p} aria-hidden>
          <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6Z" />
        </svg>
      );
    case "statement":
      return (
        <svg {...p} aria-hidden>
          <path d="M6 3h9l4 4v14H6Z" />
          <path d="M9 17c1.5-2 3 1 4.5-1s2 0 2.5-.5" />
        </svg>
      );
    default:
      return (
        <svg {...p} aria-hidden>
          <path d="M6 3h9l4 4v14H6Z" />
        </svg>
      );
  }
}

function Rows({ rows, skin }: { rows: string[][]; skin: DocSkin }) {
  return (
    <table className={`doc-rows rows-${skin}`}>
      <tbody>
        {rows.map((r, i) => {
          // Date and time columns lead; anything short and capitalised in between is a tag.
          const lead: string[] = [];
          let k = 0;
          while (k < r.length - 1 && /^[\d/:. ]+(?:[A-Z][a-z]{2})?[\d/:. ]*$/.test(r[k]!)) lead.push(r[k++]!);
          const rest = r.slice(k);
          const tags = rest.filter((c) => /^[A-Z]{2,5}$/.test(c));
          const words = rest.filter((c) => !/^[A-Z]{2,5}$/.test(c));
          const who = words.length > 1 ? words[words.length - 1] : null;
          const event = who ? words.slice(0, -1).join(" ") : words.join(" ");
          return (
            <tr key={i}>
              <td className="doc-time">{lead.join("  ")}</td>
              <td className="doc-event" colSpan={who ? 1 : 2}>
                {tags.map((t) => (
                  <span key={t} className="doc-tag">
                    {t}
                  </span>
                ))}
                {event}
              </td>
              {who && <td className="doc-who">{who}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Blocks({ blocks, skin }: { blocks: Block[]; skin: DocSkin }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "fields")
          return (
            <dl key={i} className="doc-fields">
              {b.rows.map(([k, v], j) => (
                <div key={j}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          );
        if (b.t === "rows") return <Rows key={i} rows={b.rows} skin={skin} />;
        const text = b.lines.join(" ");
        const quoted = /^["“]/.test(text);
        return quoted ? (
          <blockquote key={i} className="doc-quote">
            {text}
          </blockquote>
        ) : (
          <p key={i} className="doc-p">
            {b.lines.map((l, j) => (
              <span key={j}>
                {l}
                {j < b.lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function PhotoPlate({ text }: { text: string }) {
  const stamp = text.match(/(\d{1,2}:\d{2}:\d{2})/)?.[1] ?? "";
  const cam = text.match(/camera\s*(\d+)/i)?.[1];
  return (
    <div className="doc-photo-plate" role="img" aria-label="Dark, grainy CCTV frame; see the description below">
      <div className="photo-grain" />
      <div className="photo-figure" />
      <span className="photo-osd tl">{cam ? `CAM ${cam}` : "CAM"}</span>
      <span className="photo-osd tr">REC ●</span>
      <span className="photo-osd bl">{stamp}</span>
      <span className="photo-note">Image too dark to reproduce</span>
    </div>
  );
}

export function ExhibitDocument({ exhibit, admitted }: { exhibit: Exhibit; admitted: boolean }) {
  const skin = skinOf(exhibit);
  const blocks = parseDoc(exhibit.text);
  return (
    <article className={`doc doc-${skin}`} aria-label={`${exhibit.id}: ${exhibit.title}`}>
      <header className="doc-head">
        <span className="doc-id">Exhibit {exhibit.id}</span>
        <span className="doc-kind">
          <KindGlyph skin={skin} /> {exhibit.kind}
        </span>
        {admitted && <span className="doc-admitted">Admitted</span>}
      </header>
      <h3 className="doc-title">{exhibit.title}</h3>
      <div className="doc-paper">
        {skin === "photo" && <PhotoPlate text={exhibit.text} />}
        {skin === "ticket" && <div className="ticket-perf" aria-hidden />}
        <Blocks blocks={blocks} skin={skin} />
      </div>
    </article>
  );
}
