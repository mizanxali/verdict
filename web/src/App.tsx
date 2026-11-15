import { useEffect, useState } from "react";
import { api } from "./api";
import { Title } from "./screens/Title";
import { TrialScreen } from "./TrialScreen";
import { useTrial } from "./useTrial";
import { voicePlayer } from "./voice/player";

const LAST_KEY = "trial-sim:last";

const idFromHash = () => {
  const m = location.hash.match(/^#\/trial\/([A-Za-z0-9_-]+)$/);
  return m ? m[1]! : null;
};

export function App() {
  const [trialId, setTrialId] = useState<string | null>(idFromHash);

  useEffect(() => {
    const onHash = () => setTrialId(idFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const open = (id: string | null) => {
    if (id) {
      localStorage.setItem(LAST_KEY, id);
      location.hash = `#/trial/${id}`;
    } else {
      history.pushState(null, "", location.pathname);
    }
    setTrialId(id);
  };

  if (!trialId) return <Start onOpen={open} />;
  return <Trial key={trialId} trialId={trialId} onLeave={() => open(null)} />;
}

function Start({ onOpen }: { onOpen: (id: string) => void }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = localStorage.getItem(LAST_KEY);
  const start = async () => {
    voicePlayer.unlock(); // this click is the gesture browsers want before audio may play
    setStarting(true);
    setError(null);
    try {
      const { trialId } = await api.createTrial();
      onOpen(trialId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };
  const resume = () => {
    voicePlayer.unlock();
    if (last) onOpen(last);
  };
  return <Title onStart={start} onResume={last ? resume : null} starting={starting} error={error} lastId={last} />;
}

function Trial({ trialId, onLeave }: { trialId: string; onLeave: () => void }) {
  const trial = useTrial(trialId);
  const view = trial.view;

  useEffect(() => {
    if (trial.notFound) {
      localStorage.removeItem(LAST_KEY);
      onLeave();
    }
  }, [trial.notFound, onLeave]);

  useEffect(() => {
    if (view) document.title = `${view.caseInfo.title} · Verdict`;
  }, [view]);

  if (!view) {
    return (
      <div className="loading-screen" role="status">
        {trial.errors[0]?.text ?? "Opening the courtroom…"}
      </div>
    );
  }
  return <TrialScreen trial={trial} view={view} onLeave={onLeave} />;
}
