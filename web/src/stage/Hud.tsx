/** Heads-up display: progress, credibility, exposed contradictions, cost, menus. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Phase, PlayerView } from "../../../src/shared/types";
import { IconFolder, IconPlay, IconScroll } from "../art/Icons";
import { formatCost, phaseLabel, type CaseInfo } from "../labels";

const STEPS: { phases: Phase[]; label: (info: CaseInfo) => string }[] = [
  { phases: ["case_review", "opening"], label: () => "Openings" },
  { phases: ["w1_direct", "w1_cross"], label: (i) => i.witnesses[0]?.name.split(" ").slice(-1)[0] ?? "Witness 1" },
  { phases: ["w2_direct", "w2_cross"], label: (i) => i.witnesses[1]?.name.split(" ").slice(-1)[0] ?? "Witness 2" },
  { phases: ["w3_cross"], label: (i) => i.witnesses[2]?.name.split(" ").slice(-1)[0] ?? "Defendant" },
  { phases: ["closing"], label: () => "Closings" },
  { phases: ["verdict"], label: () => "Verdict" },
];

const ORDER: Phase[] = ["case_review", "opening", "w1_direct", "w1_cross", "w2_direct", "w2_cross", "w3_cross", "closing", "verdict"];

function PhaseTrack({ phase, info }: { phase: Phase; info: CaseInfo }) {
  const at = ORDER.indexOf(phase);
  return (
    <div className="hud-track">
      <ol aria-label="Trial progress">
        {STEPS.map((s, i) => {
          const first = ORDER.indexOf(s.phases[0]!);
          const last = ORDER.indexOf(s.phases[s.phases.length - 1]!);
          const state = at > last ? "done" : at >= first ? "now" : "todo";
          const sub = s.phases.length > 1 && state === "now" ? s.phases.indexOf(phase) : -1;
          return (
            <li key={i} className={state} aria-current={state === "now" ? "step" : undefined}>
              <span className="pip">
                {s.phases.length > 1 && (
                  <span className="pip-halves">
                    <i className={sub >= 0 || state === "done" ? "on" : ""} />
                    <i className={sub >= 1 || state === "done" ? "on" : ""} />
                  </span>
                )}
              </span>
              <span className="pip-label">{s.label(info)}</span>
            </li>
          );
        })}
      </ol>
      <span className="hud-phase-name">{phaseLabel(phase, info)}</span>
    </div>
  );
}

function Meter({ label, value, side }: { label: string; value: number; side: "defence" | "prosecution" }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const prev = useRef(v);
  const [bump, setBump] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (v !== prev.current) {
      setBump(v > prev.current ? "up" : "down");
      prev.current = v;
      const t = setTimeout(() => setBump(null), 900);
      return () => clearTimeout(t);
    }
  }, [v]);
  return (
    <div className={`meter ${side}${bump ? ` bump-${bump}` : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={`${label} credibility`}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: `${v}%` }} />
      </span>
      <b>{v}</b>
    </div>
  );
}

export function CostChip({ usage, voice, final }: { usage: PlayerView["usage"]; voice?: PlayerView["voice"]; final?: boolean }) {
  const totalIn = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const share = totalIn > 0 ? Math.round((usage.cacheReadTokens / totalIn) * 100) : 0;
  const model = `${usage.calls} model calls · ${share}% of input read from cache${usage.refusals ? ` · ${usage.refusals} refused` : ""}`;
  const voiceLine = voice
    ? `Voice ${formatCost(voice.costUsd)}: ${voice.ttsChars.toLocaleString()} characters spoken (${voice.ttsRequests} requests) · ${voice.sttSeconds.toFixed(1)} s dictated (${voice.sttRequests} takes)`
    : null;
  const detail = voiceLine ? `Model ${formatCost(usage.costUsd)}: ${model}. ${voiceLine}.` : model;
  return (
    <span
      className={`cost-chip${final ? " final" : ""}`}
      tabIndex={0}
      title={detail}
      aria-label={`API cost ${formatCost(usage.costUsd)}${voice ? `, voice ${formatCost(voice.costUsd)}` : ""}. ${detail}`}
    >
      <span className="cost-dollar">{formatCost(usage.costUsd)}</span>
      {voice ? (
        <span className="cost-calls">
          {usage.calls} calls · <span className="cost-voice">voice {formatCost(voice.costUsd)}</span>
        </span>
      ) : (
        <span className="cost-calls">{usage.calls} calls</span>
      )}
      <span className="cost-pop" role="tooltip">
        {voiceLine ? (
          <>
            <b>Model {formatCost(usage.costUsd)}</b> {model}
            <br />
            <b>Voice {formatCost(voice!.costUsd)}</b> {voiceLine.replace(/^Voice \S+: /, "")}
          </>
        ) : (
          model
        )}
      </span>
    </span>
  );
}

export function ContradictionStamps({ lies, info }: { lies: PlayerView["exposedLies"]; info: CaseInfo }) {
  return (
    <div className="hud-stamps" aria-label={`${lies.length} contradictions exposed`}>
      {lies.length === 0 ? (
        <span className="stamp-slot" title="No contradictions exposed yet">
          ?
        </span>
      ) : (
        lies.map((l) => {
          const w = info.witnesses.find((x) => x.id === l.witnessId);
          return (
            <span key={l.lieId} className="hud-stamp" tabIndex={0} title={`${w?.name ?? ""}: ${l.label}`}>
              <span className="hud-stamp-mark">✕</span>
              <span className="hud-stamp-pop" role="tooltip">
                <b>{w?.name}</b> {l.label}
              </span>
            </span>
          );
        })
      )}
    </div>
  );
}

export function Hud({
  view,
  phase,
  lies,
  auto,
  onAuto,
  onCaseFile,
  onLog,
  connection,
  voice,
}: {
  view: PlayerView;
  phase: Phase;
  lies: PlayerView["exposedLies"];
  auto: boolean;
  onAuto: () => void;
  onCaseFile: () => void;
  onLog: () => void;
  connection: string;
  /** Voice toggle and volume (rendered only when the server can speak). */
  voice?: ReactNode;
}) {
  const info = view.caseInfo;
  return (
    <div className="hud" onClick={(e) => e.stopPropagation()}>
      <div className="hud-left">
        <span className="hud-crest" aria-hidden>
          ⚖
        </span>
        <PhaseTrack phase={phase} info={info} />
      </div>
      <div className="hud-right">
        <div className="hud-meters" aria-label="Credibility">
          <Meter label="You" value={view.credibility.defence} side="defence" />
          <Meter label="Pros." value={view.credibility.prosecution} side="prosecution" />
        </div>
        <ContradictionStamps lies={lies} info={info} />
        <CostChip usage={view.usage} voice={view.voice} />
        <button type="button" className="icon-btn" onClick={onCaseFile} aria-keyshortcuts="C">
          <IconFolder /> Case file <kbd>C</kbd>
        </button>
        <button type="button" className="icon-btn" onClick={onLog} aria-keyshortcuts="T">
          <IconScroll /> Log <kbd>T</kbd>
        </button>
        <button type="button" className="icon-btn" onClick={onAuto} aria-pressed={auto} aria-keyshortcuts="A" title="Auto-advance dialogue">
          <IconPlay /> Auto <kbd>A</kbd>
        </button>
        {voice}
      </div>
      {connection !== "open" && <div className="hud-conn">{connection === "connecting" ? "Connecting to the court…" : "Reconnecting…"}</div>}
    </div>
  );
}
