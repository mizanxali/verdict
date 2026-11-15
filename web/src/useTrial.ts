/**
 * The browser's only window on the trial. `state` events replace the view wholesale; the
 * streaming events only paint in-flight text until the next state catches up.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { EntryKind, Pending, PlayerAction, PlayerView, RecordEntry, Speaker, TrialEvent } from "../../src/shared/types";
import { api, ApiError } from "./api";

export interface StreamingEntry {
  id: string;
  speaker: Speaker;
  kind: EntryKind;
  exhibitIds: string[];
  text: string;
}

export interface Toast {
  id: number;
  text: string;
}

interface State {
  view: PlayerView | null;
  streaming: StreamingEntry[];
  /** Ended entries the latest view does not contain yet (avoids a flicker between entry_end and state). */
  settled: RecordEntry[];
  notices: Toast[];
  errors: Toast[];
  connection: "connecting" | "open" | "reconnecting" | "lost";
  notFound: boolean;
  /** Set on submit; cleared once a state shows the court moved on. */
  awaiting: { pending: Pending; len: number } | null;
  /** How many times each entry id has been started. A refused reply is discarded and its id
   *  reused by the retry, so presentation keys beats on id + start count. */
  starts: Record<string, number>;
  /** Bumped on every accepted submit, so the stage knows the player just acted. */
  acted: number;
  /** performance.now() of the latest (re)connection: what follows at once is catch-up. */
  syncedAt: number;
}

type Msg =
  | { type: "event"; event: TrialEvent }
  | { type: "view"; view: PlayerView }
  | { type: "connection"; value: State["connection"] }
  | { type: "notFound" }
  | { type: "awaiting"; value: State["awaiting"] }
  | { type: "error"; message: string }
  | { type: "dismissError"; id: number }
  | { type: "dismissNotice"; id: number };

let toastSeq = 1;

const initial: State = {
  view: null,
  streaming: [],
  settled: [],
  notices: [],
  errors: [],
  connection: "connecting",
  notFound: false,
  awaiting: null,
  starts: {},
  acted: 0,
  syncedAt: 0,
};

function applyView(s: State, view: PlayerView): State {
  const ids = new Set(view.record.map((e) => e.id));
  const awaiting =
    s.awaiting && (view.pending !== s.awaiting.pending || view.record.length !== s.awaiting.len) ? null : s.awaiting;
  return {
    ...s,
    view,
    awaiting,
    settled: s.settled.filter((e) => !ids.has(e.id)),
    streaming: s.streaming.filter((e) => !ids.has(e.id)),
  };
}

function reducer(s: State, m: Msg): State {
  switch (m.type) {
    case "view":
      return applyView(s, m.view);
    case "connection":
      return { ...s, connection: m.value, syncedAt: m.value === "open" ? performance.now() : s.syncedAt };
    case "notFound":
      return { ...s, notFound: true };
    case "awaiting":
      return { ...s, awaiting: m.value, acted: m.value ? s.acted + 1 : s.acted };
    case "error":
      return { ...s, errors: [...s.errors, { id: toastSeq++, text: m.message }] };
    case "dismissError":
      return { ...s, errors: s.errors.filter((e) => e.id !== m.id) };
    case "dismissNotice":
      return { ...s, notices: s.notices.filter((e) => e.id !== m.id) };
    case "event": {
      const ev = m.event;
      switch (ev.type) {
        case "state":
          return applyView(s, ev.view);
        case "entry_start":
          if (s.view?.record.some((e) => e.id === ev.entryId)) return s;
          return {
            ...s,
            starts: { ...s.starts, [ev.entryId]: (s.starts[ev.entryId] ?? 0) + 1 },
            streaming: [
              ...s.streaming.filter((e) => e.id !== ev.entryId),
              { id: ev.entryId, speaker: ev.speaker, kind: ev.kind, exhibitIds: ev.exhibitIds, text: "" },
            ],
          };
        case "token":
          if (!s.streaming.some((e) => e.id === ev.entryId)) return s;
          return {
            ...s,
            streaming: s.streaming.map((e) => (e.id === ev.entryId ? { ...e, text: e.text + ev.text } : e)),
          };
        case "entry_end": {
          const inRecord = s.view?.record.some((e) => e.id === ev.entry.id);
          return {
            ...s,
            streaming: s.streaming.filter((e) => e.id !== ev.entry.id),
            settled: inRecord ? s.settled : [...s.settled.filter((e) => e.id !== ev.entry.id), ev.entry],
          };
        }
        case "entry_discard":
          return { ...s, streaming: s.streaming.filter((e) => e.id !== ev.entryId) };
        case "notice":
          return { ...s, notices: [...s.notices, { id: toastSeq++, text: ev.text }] };
        case "error":
          return { ...s, errors: [...s.errors, { id: toastSeq++, text: ev.message }], awaiting: null };
      }
    }
  }
  return s;
}

export function useTrial(trialId: string) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    api
      .getTrial(trialId)
      .then(({ view }) => !closed && dispatch({ type: "view", view }))
      .catch((e: unknown) => {
        if (closed) return;
        if (e instanceof ApiError && e.status === 404) dispatch({ type: "notFound" });
        else dispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
      });

    const connect = () => {
      es = new EventSource(api.eventsUrl(trialId));
      es.onopen = () => dispatch({ type: "connection", value: "open" });
      es.onmessage = (msg) => {
        if (!msg.data) return;
        try {
          dispatch({ type: "event", event: JSON.parse(msg.data) as TrialEvent });
        } catch {
          /* ignore malformed frames */
        }
      };
      es.onerror = () => {
        if (closed || !es) return;
        if (es.readyState === EventSource.CLOSED) {
          // The browser gave up (server down or non-200). Retry ourselves.
          dispatch({ type: "connection", value: "lost" });
          es.close();
          retry = setTimeout(connect, 3000);
        } else {
          dispatch({ type: "connection", value: "reconnecting" });
        }
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [trialId]);

  // Notices are transient.
  useEffect(() => {
    if (!state.notices.length) return;
    const first = state.notices[0]!;
    const t = setTimeout(() => dispatch({ type: "dismissNotice", id: first.id }), 7000);
    return () => clearTimeout(t);
  }, [state.notices]);

  /** Resolves true if the court accepted the action. */
  const act = useCallback(
    async (action: PlayerAction): Promise<boolean> => {
      const v = stateRef.current.view;
      if (!v) return false;
      dispatch({ type: "awaiting", value: { pending: v.pending, len: v.record.length } });
      try {
        await api.act(trialId, action);
        return true;
      } catch (e) {
        dispatch({ type: "awaiting", value: null });
        dispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [trialId],
  );

  return {
    ...state,
    act,
    dismissError: (id: number) => dispatch({ type: "dismissError", id }),
    dismissNotice: (id: number) => dispatch({ type: "dismissNotice", id }),
  };
}

export type TrialHandle = ReturnType<typeof useTrial>;
