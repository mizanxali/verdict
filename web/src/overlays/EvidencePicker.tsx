/** "Present evidence": pick exhibits to put to the witness with the next question. */
import { useState } from "react";
import { IconClose } from "../art/Icons";
import type { CaseInfo } from "../labels";
import { ExhibitDocument, ExhibitThumb, skinOf } from "./Documents";
import { Modal } from "./Modal";

export function EvidencePicker({
  info,
  admitted,
  selected,
  witnessName,
  onToggle,
  onClose,
}: {
  info: CaseInfo;
  admitted: string[];
  selected: string[];
  witnessName: string;
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const [reading, setReading] = useState<string | null>(null);
  const doc = reading ? info.evidence.find((e) => e.id === reading) : null;
  return (
    <Modal label="Present evidence" onClose={reading ? () => setReading(null) : onClose} className="evidence-modal" initialFocus=".ev-card">
      <header className="ev-head">
        <div>
          <span className="binder-kicker">Present evidence to {witnessName}</span>
          <h2>Choose the exhibits to put with your question</h2>
        </div>
        <button type="button" className="binder-close" onClick={onClose} aria-label="Close (Esc)">
          <IconClose />
        </button>
      </header>
      <div className={`ev-body${doc ? " reading" : ""}`}>
        <div className="ev-grid" role="group" aria-label="Exhibits">
          {info.evidence.map((e) => {
            const on = selected.includes(e.id);
            return (
              <div key={e.id} className={`ev-card-wrap${on ? " on" : ""}${reading === e.id ? " reading" : ""}`}>
                <button type="button" className="ev-card" role="checkbox" aria-checked={on} onClick={() => onToggle(e.id)}>
                  <span className="ev-check" aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                  <span className="ev-id">{e.id}</span>
                  <span className="ev-glyph">
                    <ExhibitThumb skin={skinOf(e)} />
                  </span>
                  <span className="ev-title">{e.title}</span>
                  <span className="ev-kind">{e.kind}</span>
                  {admitted.includes(e.id) && <span className="ev-admitted">Admitted</span>}
                </button>
                <button type="button" className="ev-read" onClick={() => setReading(reading === e.id ? null : e.id)} aria-label={`Read ${e.id}, ${e.title}`}>
                  {reading === e.id ? "Close" : "Read"}
                </button>
              </div>
            );
          })}
        </div>
        {doc && (
          <div className="ev-doc">
            <ExhibitDocument exhibit={doc} admitted={admitted.includes(doc.id)} />
          </div>
        )}
      </div>
      <footer className="ev-foot">
        <span className="ev-selected">
          {selected.length === 0 ? "Nothing attached. A question can stand on its own." : `Attached: ${selected.join(", ")}`}
        </span>
        <span className="hint">
          <kbd>Space</kbd> to tick · <kbd>Esc</kbd> to close
        </span>
        <button type="button" className="btn primary" onClick={onClose}>
          {selected.length ? `Attach ${selected.length} and return` : "Return to the question"}
        </button>
      </footer>
    </Modal>
  );
}
