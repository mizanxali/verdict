/** Letterboxes the fixed 1600 x 900 stage into the window, so the composition never reflows. */
import { useLayoutEffect, useState, type ReactNode } from "react";
import { STAGE_H, STAGE_W } from "./layout";

export function useStageScale() {
  const [k, setK] = useState(() => fit());
  useLayoutEffect(() => {
    const on = () => setK(fit());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return k;
}

function fit() {
  if (typeof window === "undefined") return 1;
  return Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
}

export function StageFrame({ children, className }: { children: ReactNode; className?: string }) {
  const k = useStageScale();
  return (
    <div className={`stage-frame ${className ?? ""}`}>
      <div
        className="stage"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${k})`,
          ["--k" as string]: k,
        }}
      >
        {children}
      </div>
    </div>
  );
}
