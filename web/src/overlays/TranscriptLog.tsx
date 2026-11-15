/** The full record, as a log you can open at any time. */
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { RecordEntry } from "../../../src/shared/types";
import { Portrait } from "../art/Character";
import { designFor } from "../art/cast";
import { IconClose } from "../art/Icons";
import { phaseLabel, speakerName, tagLabel, tagPolarity, type CaseInfo } from "../labels";
import { Modal } from "./Modal";

const KIND: Record<string, string> = { question: "Q", answer: "A", objection: "Objection", ruling: "Ruling", statement: "Statement" };

const designKey = (e: RecordEntry) => (e.speaker.kind === "witness" ? e.speaker.witnessId : e.speaker.kind);

function FactFlags({ entry }: { entry: RecordEntry }) {
  const flagged = entry.factCheck?.claims.filter((c) => c.verdict !== "supported") ?? [];
  if (!flagged.length) return null;
  return (
    <ul className="log-flags" aria-label="Fact-check flags">
      {flagged.map((c, i) => (
        <li key={i} className={`flag ${c.verdict}`}>
          <span className="flag-verdict">{c.verdict === "contradicted" ? "Contradicted" : "Unsupported"}</span>
          <q>{c.text}</q>
          <span className="flag-reason">{c.reason}</span>
          {c.refs.length > 0 && <span className="flag-refs">see {c.refs.join(", ")}</span>}
        </li>
      ))}
    </ul>
  );
}

export function LogEntry({ e, info, onExhibit, highlight, extra }: { e: RecordEntry; info: CaseInfo; onExhibit: (id: string) => void; highlight?: boolean; extra?: ReactNode }) {
  const clerk = e.speaker.kind === "clerk";
  const tags = e.tags.filter((t) => t.type !== "claim_flagged" || e.speaker.kind !== "player");
  return (
    <li id={`log-${e.id}`} className={`log-entry sp-${e.speaker.kind}${clerk ? " clerk" : ""}${e.stricken ? " stricken" : ""}${highlight ? " highlight" : ""}`}>
      {!clerk && <Portrait design={designFor(designKey(e))} seed={designKey(e)} size={44} bg="#2b241e" className="log-face" />}
      <div className="log-body">
        {!clerk && (
          <div className="log-head">
            <span className="log-name">{speakerName(e.speaker, info)}</span>
            {KIND[e.kind] && <span className="log-kind">{KIND[e.kind]}</span>}
            {e.stricken && <span className="log-struck">Struck from the record</span>}
            <span className="log-id">{e.id}</span>
          </div>
        )}
        <p className="log-text">{e.text}</p>
        {e.exhibitIds.length > 0 && (
          <div className="log-exhibits">
            {e.exhibitIds.map((id) => {
              const ex = info.evidence.find((x) => x.id === id);
              return (
                <button key={id} type="button" className="exhibit-chip" onClick={() => onExhibit(id)} title="Open in the case file">
                  <b>{id}</b> <span>{ex?.title}</span>
                </button>
              );
            })}
          </div>
        )}
        {e.speaker.kind === "player" && <FactFlags entry={e} />}
        {tags.length > 0 && (
          <ul className="tag-chips">
            {tags.map((t, i) => (
              <li key={i} className={`tag p${tagPolarity(t)}`}>
                {tagLabel(t, info)}
              </li>
            ))}
          </ul>
        )}
        {extra}
      </div>
    </li>
  );
}

export function TranscriptLog({
  record,
  info,
  onClose,
  onExhibit,
  highlight,
  upTo,
}: {
  record: RecordEntry[];
  info: CaseInfo;
  onClose: () => void;
  onExhibit: (id: string) => void;
  highlight?: string | null;
  /** Hide entries the stage has not presented yet. */
  upTo?: number;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const shown = upTo === undefined ? record : record.filter((e) => Number(e.id.slice(1)) <= upTo);
  useEffect(() => {
    const el = highlight ? document.getElementById(`log-${highlight}`) : null;
    if (el) el.scrollIntoView({ block: "center" });
    else listRef.current?.parentElement?.scrollTo({ top: 1e9 });
  }, [highlight]);
  let lastPhase: string | null = null;
  return (
    <Modal label="Transcript" onClose={onClose} className="log-drawer" initialFocus=".binder-close">
      <header className="log-top">
        <div>
          <span className="binder-kicker">The record</span>
          <h2>Transcript</h2>
        </div>
        <button type="button" className="binder-close" onClick={onClose} aria-label="Close transcript (Esc)">
          <IconClose />
        </button>
      </header>
      <div className="log-scroll" tabIndex={0}>
        {shown.length === 0 && <p className="log-empty">Nothing has been said on the record yet.</p>}
        <ol ref={listRef} className="log-list">
          {shown.map((e) => {
            const divider = e.phase !== lastPhase ? <li className="log-phase">{phaseLabel(e.phase, info)}</li> : null;
            lastPhase = e.phase;
            return (
              <Fragment key={e.id}>
                {divider}
                <LogEntry e={e} info={info} onExhibit={onExhibit} highlight={e.id === highlight} />
              </Fragment>
            );
          })}
        </ol>
      </div>
    </Modal>
  );
}
