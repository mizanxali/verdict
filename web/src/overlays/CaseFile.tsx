/** The case binder: brief, exhibits, witnesses, rules and jury, one tab each. */
import { useEffect, useRef, type ReactNode } from "react";
import { Portrait } from "../art/Character";
import { designFor } from "../art/cast";
import { IconClose } from "../art/Icons";
import type { CaseInfo } from "../labels";
import { ExhibitDocument, KindGlyph, skinOf } from "./Documents";
import { Modal } from "./Modal";

export type CaseTab = "brief" | "exhibits" | "witnesses" | "rules" | "jury";

const TABS: { id: CaseTab; label: string; key: string }[] = [
  { id: "brief", label: "Brief", key: "1" },
  { id: "exhibits", label: "Exhibits", key: "2" },
  { id: "witnesses", label: "Witnesses", key: "3" },
  { id: "rules", label: "Rules", key: "4" },
  { id: "jury", label: "Jury", key: "5" },
];

function Brief({ info }: { info: CaseInfo }) {
  const paras = info.publicBrief.split(/\n\s*\n/).filter(Boolean);
  return (
    <div className="cf-brief">
      <aside className="cf-charge">
        <span className="cf-stamp">Defence copy</span>
        <h3>{info.title}</h3>
        <dl>
          <dt>Charge</dt>
          <dd>{info.charge}</dd>
          <dt>Your client</dt>
          <dd>{info.defendantName}</dd>
          <dt>For the Commonwealth</dt>
          <dd>{info.prosecutorName}</dd>
          <dt>Presiding</dt>
          <dd>{info.judgeName}</dd>
        </dl>
        <div className="cf-howto">
          <h4>How this trial goes</h4>
          <ol>
            <li>Openings: the prosecution, then you.</li>
            <li>Two prosecution witnesses. Object to bad questions, then cross-examine.</li>
            <li>Your client is cross-examined. Object when the rules are broken.</li>
            <li>Closings, then five jurors vote.</li>
          </ol>
          <p>Put the right exhibit to the right witness and their story breaks. Claims you cannot back up cost you credibility.</p>
        </div>
      </aside>
      <div className="cf-brief-body">
        {paras.map((p, i) => {
          const lines = p.split("\n");
          if (lines.some((l) => l.trim().startsWith("- "))) {
            const head = lines.filter((l) => !l.trim().startsWith("- "));
            return (
              <section key={i} className="cf-facts">
                {head.map((h, j) => (
                  <h4 key={j}>{h.replace(/:$/, "")}</h4>
                ))}
                <ul>
                  {lines
                    .filter((l) => l.trim().startsWith("- "))
                    .map((l, j) => (
                      <li key={j}>{l.trim().slice(2)}</li>
                    ))}
                </ul>
              </section>
            );
          }
          return (
            <p key={i} className="cf-p">
              {lines.map((l, j) => (
                <span key={j}>
                  {l}
                  {j < lines.length - 1 && <br />}
                </span>
              ))}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export function Exhibits({ info, admitted, focus, onFocus }: { info: CaseInfo; admitted: string[]; focus: string; onFocus: (id: string) => void }) {
  const ex = info.evidence.find((e) => e.id === focus) ?? info.evidence[0];
  const docRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    docRef.current?.scrollTo({ top: 0 });
  }, [focus]);
  return (
    <div className="cf-exhibits">
      <nav className="ex-list" aria-label="Exhibits">
        {info.evidence.map((e) => (
          <button key={e.id} type="button" className={`ex-card${e.id === ex?.id ? " on" : ""}`} onClick={() => onFocus(e.id)} aria-current={e.id === ex?.id}>
            <span className="ex-card-id">{e.id}</span>
            <span className="ex-card-glyph">
              <KindGlyph skin={skinOf(e)} />
            </span>
            <span className="ex-card-title">{e.title}</span>
            {admitted.includes(e.id) && <span className="ex-card-admitted">Admitted</span>}
          </button>
        ))}
        <p className="ex-hint">
          <kbd>↑</kbd> <kbd>↓</kbd> to flip
        </p>
      </nav>
      <div className="ex-view" ref={docRef}>
        {ex && <ExhibitDocument key={ex.id} exhibit={ex} admitted={admitted.includes(ex.id)} />}
      </div>
    </div>
  );
}

function Witnesses({ info }: { info: CaseInfo }) {
  return (
    <div className="cf-witnesses">
      {info.witnesses.map((w, i) => (
        <article key={w.id} className="wit-card">
          <header>
            <Portrait design={designFor(w.id)} seed={w.id} size={112} bg="#2d3f58" className="wit-portrait" />
            <div>
              <span className="wit-order">{i === 2 ? "Your client · cross-examined by the prosecution" : `Prosecution witness ${i + 1}`}</span>
              <h3>{w.name}</h3>
              <p className="wit-role">{w.role}</p>
            </div>
          </header>
          <div className="wit-statement">
            <span className="wit-statement-label">Prior statement</span>
            {w.publicStatement
              .split(/\n\s*\n/)
              .filter(Boolean)
              .map((p, j) => (
                <p key={j} className={/^["“]/.test(p) ? "quote" : ""}>
                  {p}
                </p>
              ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function Rules({ info }: { info: CaseInfo }) {
  return (
    <div className="cf-rules">
      <h3>The six objections</h3>
      <p className="cf-note">When the prosecution asks a question you get a moment to object. Press the number key, or let it stand.</p>
      <div className="rule-grid">
        {info.rules.objections.map((o, i) => (
          <article key={o.type} className="rule-card">
            <span className="rule-key">{i + 1}</span>
            <h4>{o.name}</h4>
            <p>{o.rule}</p>
            <p className="rule-eg">{o.example}</p>
          </article>
        ))}
      </div>
      <h3>Evidence</h3>
      <ul className="evidence-rules">
        {info.rules.evidence.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function Jury({ info }: { info: CaseInfo }) {
  return (
    <div className="cf-jury">
      <p className="cf-note">Five jurors. Four votes either way decide it; anything less is a hung jury. Their leanings stay sealed until the verdict.</p>
      <div className="jury-grid">
        {info.jurors.map((j, i) => (
          <article key={j.id} className="juror-card">
            <Portrait design={designFor(j.id)} seed={j.id} size={120} bg="#3a2a2e" />
            <span className="juror-seat">Seat {i + 1}</span>
            <h4>{j.name}</h4>
            <p>{j.persona}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function CaseFile({
  info,
  admitted,
  tab,
  onTab,
  exhibit,
  onExhibit,
  onClose,
  footer,
}: {
  info: CaseInfo;
  admitted: string[];
  tab: CaseTab;
  onTab: (t: CaseTab) => void;
  exhibit: string;
  onExhibit: (id: string) => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <Modal
      label="Case file"
      onClose={onClose}
      className="binder"
      initialFocus=".binder-tab.on"
      onKey={(e) => {
        if (e.altKey || e.metaKey || e.ctrlKey) return false;
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "TEXTAREA" || tag === "INPUT") return false;
        const t = TABS.find((x) => x.key === e.key);
        if (t) {
          onTab(t.id);
          requestAnimationFrame(() => document.querySelector<HTMLElement>(".binder-tab.on")?.focus());
          return true;
        }
        if (tab !== "exhibits") return false;
        const d = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
        if (!d) return false;
        const i = info.evidence.findIndex((x) => x.id === exhibit);
        const next = info.evidence[(Math.max(0, i) + d + info.evidence.length) % info.evidence.length];
        if (next) {
          onExhibit(next.id);
          requestAnimationFrame(() => document.querySelector<HTMLElement>(".ex-card.on")?.focus());
        }
        return true;
      }}
    >
      <div className="binder-inner">
        <div className="binder-rings" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <i key={i} />
          ))}
        </div>
        <header className="binder-head">
          <div className="binder-title">
            <span className="binder-kicker">Case file</span>
            <h2>{info.title}</h2>
          </div>
          <div className="binder-tabs" role="tablist" aria-label="Case file sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`binder-tab${tab === t.id ? " on" : ""}`} onClick={() => onTab(t.id)}>
                {t.label} <span className="kbd-hint">{t.key}</span>
              </button>
            ))}
          </div>
          <button type="button" className="binder-close" onClick={onClose} aria-label="Close case file (Esc)">
            <IconClose />
          </button>
        </header>
        <div className="binder-body" role="tabpanel">
          {tab === "brief" && <Brief info={info} />}
          {tab === "exhibits" && <Exhibits info={info} admitted={admitted} focus={exhibit} onFocus={onExhibit} />}
          {tab === "witnesses" && <Witnesses info={info} />}
          {tab === "rules" && <Rules info={info} />}
          {tab === "jury" && <Jury info={info} />}
        </div>
        {footer && <footer className="binder-foot">{footer}</footer>}
      </div>
    </Modal>
  );
}
