/** Speech bubbles anchored to speakers, and the clerk's caption. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { revealedChars, type Beat } from "../usePresenter";
import type { CaseInfo } from "../labels";
import { actorHead, toScreen, type Camera, type CourtState } from "./Courtroom";

interface Placement {
  x: number;
  w: number;
  /** Top-anchored bubbles grow down; bottom-anchored grow up. */
  top?: number;
  bottom?: number;
  maxH: number;
}

export function speakerKey(b: Pick<Beat, "speaker">): string {
  const s = b.speaker;
  return s.kind === "witness" ? `w:${s.witnessId}` : s.kind;
}

function placementFor(key: string, kind: Beat["kind"]): Placement {
  // Cards sit clear of the speaker's face, toward the middle of the room, so the tail reads.
  if (kind === "statement") return { x: 330, w: 940, bottom: 462, maxH: 360 };
  switch (key) {
    case "judge":
      return { x: 470, w: 660, bottom: 318, maxH: 228 };
    case "prosecutor":
      return { x: 560, w: 520, bottom: 462, maxH: 280 };
    case "player":
      return { x: 640, w: 520, bottom: 462, maxH: 280 };
    default:
      return { x: 1000, w: 572, bottom: 372, maxH: 282 };
  }
}

export function speakerTitle(b: Beat, info: CaseInfo): { name: string; role: string } {
  const s = b.speaker;
  switch (s.kind) {
    case "player":
      return { name: "You", role: "Defence" };
    case "prosecutor":
      return { name: info.prosecutorName, role: "Prosecution" };
    case "judge":
      return { name: info.judgeName, role: "The Court" };
    case "clerk":
      return { name: "Clerk", role: "" };
    case "witness": {
      const w = info.witnesses.find((x) => x.id === s.witnessId);
      const defendant = info.witnesses[2]?.id === s.witnessId;
      return { name: w?.name ?? "Witness", role: defendant ? "Defendant" : "Witness" };
    }
  }
}

const KIND_TAG: Partial<Record<Beat["kind"], string>> = { question: "Q", answer: "A", objection: "Objection", ruling: "Ruling" };

/** Re-renders on animation frames while a line is typing out. */
function useTypewriter(beat: Beat, reveal: { start: number; skipped: boolean } | null) {
  const [, force] = useState(0);
  const n = revealedChars(beat, reveal, performance.now());
  const complete = n >= beat.text.length && beat.ended;
  useEffect(() => {
    if (complete || !reveal) return;
    let raf = 0;
    const loop = () => {
      force((x) => x + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [complete, reveal, beat.text.length]);
  return n;
}

export function Bubble({
  beat,
  reveal,
  info,
  court,
  cam,
  canContinue,
  done,
  onExhibit,
  struck,
}: {
  beat: Beat;
  reveal: { start: number; skipped: boolean } | null;
  info: CaseInfo;
  court: CourtState;
  cam: Camera;
  canContinue: boolean;
  done: boolean;
  onExhibit: (id: string) => void;
  struck: boolean;
}) {
  const key = speakerKey(beat);
  const pl = placementFor(key, beat.kind);
  const n = useTypewriter(beat, reveal);
  const shown = beat.text.slice(0, n);
  const typing = !done;
  const textRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ h: number } | null>(null);
  const pinned = useRef(true);

  // Follow the text as it types, unless the player scrolled back to reread.
  const [moreAbove, setMoreAbove] = useState(false);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
    if (el) setMoreAbove(el.scrollTop > 4);
  }, [n]);
  useLayoutEffect(() => {
    pinned.current = true;
  }, [beat.key]);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && el.offsetHeight !== box?.h) setBox({ h: el.offsetHeight });
  });

  const { name, role } = speakerTitle(beat, info);
  const head = toScreen(cam, actorHead(key, court));
  const h = box?.h ?? 120;
  const top = pl.top ?? (pl.bottom ?? 0) - h;
  const bottom = top + h;

  // Tail: a tapered wedge from whichever bubble edge faces the speaker's face.
  const face = { x: head.x, y: head.y + 40 };
  let tail: string;
  if (face.y > bottom + 10) {
    const bx = Math.max(pl.x + 44, Math.min(pl.x + pl.w - 44, face.x + (face.x < pl.x + pl.w / 2 ? 60 : -60)));
    const tip = { x: face.x + (face.x < bx ? 34 : face.x > bx ? -34 : 0), y: Math.max(bottom + 24, face.y - 30) };
    tail = `M ${bx - 22} ${bottom - 4} L ${tip.x} ${tip.y} L ${bx + 22} ${bottom - 4} Z`;
  } else if (face.x < pl.x) {
    const by = Math.max(top + 30, Math.min(bottom - 30, face.y - 10));
    const tip = { x: face.x + 36, y: face.y };
    tail = `M ${pl.x + 4} ${by - 18} L ${tip.x} ${tip.y} L ${pl.x + 4} ${by + 18} Z`;
  } else {
    const by = Math.max(top + 30, Math.min(bottom - 30, face.y - 10));
    const tip = { x: face.x - 36, y: face.y };
    tail = `M ${pl.x + pl.w - 4} ${by - 18} L ${tip.x} ${tip.y} L ${pl.x + pl.w - 4} ${by + 18} Z`;
  }

  const cls = beat.speaker.kind === "witness" ? "witness" : beat.speaker.kind;
  return (
    <>
      <svg className={`bubble-tail-svg sp-${cls}`} width={1600} height={900} aria-hidden>
        <path d={tail} className="bubble-tail" />
      </svg>
      <div
        ref={boxRef}
        key={beat.key}
        className={`bubble sp-${cls} k-${beat.kind}${struck ? " struck" : ""}${typing ? " typing" : ""}`}
        style={{ left: pl.x, width: pl.w, top: pl.top, bottom: pl.bottom !== undefined ? 900 - pl.bottom : undefined, maxHeight: pl.maxH }}
        role="group"
        aria-label={`${name} speaking`}
      >
        <div className="bubble-head">
          <span className="bubble-name">{name}</span>
          {role && <span className="bubble-role">{role}</span>}
          {KIND_TAG[beat.kind] && <span className="bubble-kind">{KIND_TAG[beat.kind]}</span>}
          {struck && <span className="bubble-struck-tag">Struck</span>}
        </div>
        <div
          className={`bubble-text${moreAbove ? " more-above" : ""}`}
          ref={textRef}
          tabIndex={0}
          aria-label="Scroll to reread"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
            setMoreAbove(el.scrollTop > 4);
          }}
        >
          <span className={struck ? "strike-line" : undefined}>{shown}</span>
          {typing && <span className="caret" aria-hidden />}
        </div>
        {beat.exhibitIds.length > 0 && (
          <div className="bubble-exhibits">
            <span className="bubble-exhibits-label">Presented</span>
            {beat.exhibitIds.map((id) => {
              const ex = info.evidence.find((e) => e.id === id);
              return (
                <button key={id} type="button" className="exhibit-chip" onClick={(e) => (e.stopPropagation(), onExhibit(id))} title={ex ? `${ex.title}. Open the document.` : id}>
                  <b>{id}</b>
                  <span>{ex?.title ?? ""}</span>
                </button>
              );
            })}
          </div>
        )}
        {canContinue && (
          <span className="bubble-continue" aria-hidden>
            <span className="tri" /> <kbd>Space</kbd>
          </span>
        )}
      </div>
      {/* screen readers get the whole line once it has landed */}
      <div className="sr-only" aria-live="polite">
        {done ? `${name}: ${beat.text}` : ""}
      </div>
    </>
  );
}

export function Caption({ beat, reveal, done, canContinue }: { beat: Beat; reveal: { start: number; skipped: boolean } | null; done: boolean; canContinue: boolean }) {
  const n = useTypewriter(beat, reveal);
  return (
    <div className="caption" key={beat.key}>
      <span className="caption-kicker">Clerk of the Court</span>
      <p>
        {beat.text.slice(0, n)}
        {!done && <span className="caret" aria-hidden />}
      </p>
      {canContinue && (
        <span className="bubble-continue" aria-hidden>
          <span className="tri" /> <kbd>Space</kbd>
        </span>
      )}
      <div className="sr-only" aria-live="polite">
        {done ? `Clerk: ${beat.text}` : ""}
      </div>
    </div>
  );
}

/** "…" over whoever the court is waiting on, so silence never looks like a hang. */
export function Thinking({ who, court, cam }: { who: string; court: CourtState; cam: Camera }) {
  const head = toScreen(cam, actorHead(who, court));
  return (
    <div className="thinking" style={{ left: head.x + 26, top: head.y - 34 }} aria-hidden>
      <i />
      <i />
      <i />
    </div>
  );
}
