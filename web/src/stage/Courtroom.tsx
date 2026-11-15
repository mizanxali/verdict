/**
 * The living courtroom: scenery layers interleaved with the cast, a camera that leans toward
 * whoever is speaking, a spotlight, entrances and exits. Pure presentation: the parent says
 * who is where and who is talking; this decides how that looks.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Character, type Design, type Mood, type Pose } from "../art/Character";
import { designFor } from "../art/cast";
import { clamp, prefersReducedMotion } from "../util";
import { headOf, JUROR_SEATS, SPOTS, spotTransform, STAGE_H, STAGE_W, type Spot } from "./layout";
import { BackWall, Bench, ClerkDesk, CounselTables, DoorLeaf, GalleryRail, Haze, JuryBack, JuryFront, JuryMid, SceneDefs, WitnessStand } from "./Scene";

export interface CourtState {
  inSession: boolean;
  stand: string | null; // witness id on the stand
  witnessIds: string[];
  defendantId: string;
  jurorIds: string[];
  judgeName: string;
  standName: string | null;
  speaker: string | null; // who the scene focuses on: judge | prosecutor | player | w:<id>
  talker: string | null; // whose mouth is moving (may be the clerk)
  up: { player: boolean; prosecutor: boolean };
  moods: Record<string, Mood | undefined>;
  poses: Record<string, Pose | undefined>;
  jurorsUp: boolean[];
  startle: number;
  freeze: boolean;
  push: boolean;
}

type At = "door" | "stand" | "defendant";

const WALK_SPEED = 170; // design units per second (the figures are smaller in the rendered room)

/** Waypoints for a witness walking between two places. */
function route(from: At, to: At): Spot[] {
  const seated: Spot = SPOTS.defendant;
  const up: Spot = SPOTS.defendantUp;
  const mid1: Spot = SPOTS.mid1;
  const mid2: Spot = SPOTS.mid2;
  const paths: Record<string, Spot[]> = {
    "door>stand": [SPOTS.door, SPOTS.doorway, SPOTS.stand],
    "stand>door": [SPOTS.stand, SPOTS.doorway, SPOTS.door],
    "defendant>stand": [seated, up, mid1, mid2, SPOTS.stand],
    "stand>defendant": [SPOTS.stand, mid2, mid1, up, seated],
  };
  return paths[`${from}>${to}`] ?? [spotFor(from), spotFor(to)];
}

const spotFor = (at: At): Spot => (at === "door" ? SPOTS.door : at === "stand" ? SPOTS.stand : SPOTS.defendant);

function routeDuration(path: Spot[]): number {
  let d = 0;
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y) + 40;
  return (d / WALK_SPEED) * 1000;
}

/** How long a change of witness takes on stage, so the presenter can hold the beat. */
export function standChangeMs(from: string | null, to: string | null, defendantId: string): number {
  if (from === to || prefersReducedMotion()) return 600;
  let ms = 0;
  if (from) ms += routeDuration(route("stand", from === defendantId ? "defendant" : "door"));
  if (to) ms += routeDuration(route(to === defendantId ? "defendant" : "door", "stand"));
  return ms + 300;
}

interface ActorProps {
  seed: string;
  design: Design;
  spot: Spot;
  at?: At;
  delay?: number;
  mood?: Mood;
  pose?: Pose;
  talking?: boolean;
  look?: number;
  hidden?: boolean;
  onWalk?: (walking: boolean) => void;
  startle?: number;
  className?: string;
}

const Actor = memo(function Actor({ seed, design, spot, at, delay = 0, mood, pose, talking, look, hidden, onWalk, startle, className }: ActorProps) {
  const ref = useRef<SVGGElement>(null);
  const inner = useRef<SVGGElement>(null);
  const prevAt = useRef(at);
  const [walking, setWalking] = useState(false);

  useLayoutEffect(() => {
    const from = prevAt.current;
    prevAt.current = at;
    if (!at || !from || from === at || !ref.current) return;
    const el = ref.current;
    const path = route(from, at);
    if (prefersReducedMotion()) {
      el.animate([{ opacity: 0 }, { opacity: spot.hidden ? 0 : 1 }], { duration: 500, delay, fill: "backwards" });
      return;
    }
    const duration = routeDuration(path);
    // offsets proportional to distance so the pace stays even
    const seg = path.map((p, i) => (i === 0 ? 0 : Math.hypot(p.x - path[i - 1]!.x, p.y - path[i - 1]!.y) + 40));
    const total = seg.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    const frames = path.map((p, i) => {
      acc += seg[i]!;
      return { transform: spotTransform(p), opacity: p.hidden ? 0 : 1, offset: acc / total };
    });
    const anim = el.animate(frames, { duration, delay, easing: "linear", fill: "both" });
    const t = setTimeout(() => {
      setWalking(true);
      onWalk?.(true);
    }, delay);
    anim.finished
      .then(() => {
        anim.cancel();
      })
      .catch(() => undefined)
      .finally(() => {
        setWalking(false);
        onWalk?.(false);
      });
    return () => {
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  useEffect(() => {
    if (!startle || !inner.current || prefersReducedMotion()) return;
    inner.current.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(-7px)" }, { transform: "translateY(0)" }],
      { duration: 380, delay: (seed.length * 37) % 120, easing: "ease-out" },
    );
  }, [startle, seed]);

  return (
    <g
      ref={ref}
      className={`actor ${className ?? ""}${hidden ? " actor-hidden" : ""}`}
      style={{ transform: spotTransform(spot), opacity: spot.hidden || hidden ? 0 : 1 }}
    >
      <g ref={inner}>
        <Character design={design} seed={seed} mood={mood} pose={pose} talking={talking} look={look} walking={walking} />
      </g>
    </g>
  );
});

/** World position of an actor's head-top, for bubble tails and the spotlight. */
export function actorHead(key: string, s: Pick<CourtState, "up" | "stand" | "defendantId">): { x: number; y: number } {
  switch (key) {
    case "judge":
      return headOf(SPOTS.judge);
    case "clerk":
      return headOf(SPOTS.clerk);
    case "prosecutor":
      return headOf(s.up.prosecutor ? SPOTS.prosecutorUp : SPOTS.prosecutor, 1.06);
    case "player":
      return headOf(s.up.player ? SPOTS.playerUp : SPOTS.player, 1.02);
    default: {
      const id = key.replace(/^w:/, "");
      if (s.stand === id) return headOf(SPOTS.stand);
      if (id === s.defendantId) return headOf(SPOTS.defendant);
      return headOf(SPOTS.doorway);
    }
  }
}

export interface Camera {
  z: number;
  ox: number;
  oy: number;
}

export function cameraFor(s: CourtState): Camera {
  if (!s.push || !s.speaker || s.speaker === "clerk" || prefersReducedMotion()) return { z: 1, ox: STAGE_W / 2, oy: STAGE_H / 2 };
  const h = actorHead(s.speaker, s);
  return { z: 1.12, ox: h.x, oy: clamp(h.y + 90, 200, 700) };
}

export const toScreen = (cam: Camera, p: { x: number; y: number }) => ({
  x: cam.ox + (p.x - cam.ox) * cam.z,
  y: cam.oy + (p.y - cam.oy) * cam.z,
});

function lookAt(selfX: number, targetX: number | null, gain = 1): number {
  if (targetX === null) return 0;
  return clamp(((targetX - selfX) / 260) * gain, -1, 1);
}

export function Courtroom({ s, overlay }: { s: CourtState; overlay?: ReactNode }) {
  const [doorOpen, setDoorOpen] = useState(false);

  // When the witness changes, the newcomer waits for the previous one to leave. Computed during
  // render so the walking actor sees its delay in the same commit that moves it.
  const standRef = useRef<{ stand: string | null; from: string | null; delays: Record<string, number> }>({ stand: s.stand, from: null, delays: {} });
  if (standRef.current.stand !== s.stand) {
    const from = standRef.current.stand;
    const exitMs = from ? routeDuration(route("stand", from === s.defendantId ? "defendant" : "door")) : 0;
    const enterDelay = from && !prefersReducedMotion() ? Math.round(exitMs) : 0;
    standRef.current = { stand: s.stand, from, delays: s.stand ? { [s.stand]: enterDelay } : {} };
  }
  const delays = standRef.current.delays;

  // Swing the door while anyone walks through it.
  useEffect(() => {
    const { from, stand: to } = standRef.current;
    if (from === to || prefersReducedMotion()) return;
    const usesDoor = (from && from !== s.defendantId) || (to && to !== s.defendantId);
    if (!usesDoor) return;
    const exitMs = from ? routeDuration(route("stand", from === s.defendantId ? "defendant" : "door")) : 0;
    const enterDelay = to ? delays[to] ?? 0 : 0;
    const enterMs = to ? routeDuration(route(to === s.defendantId ? "defendant" : "door", "stand")) : 0;
    const openAt = from && from !== s.defendantId ? exitMs * 0.6 : enterDelay;
    const closeAt = to && to !== s.defendantId ? enterDelay + enterMs * 0.35 : exitMs + 200;
    const t1 = setTimeout(() => setDoorOpen(true), Math.max(0, openAt - 350));
    const t2 = setTimeout(() => setDoorOpen(false), closeAt + 200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.stand, s.defendantId]);

  const cam = cameraFor(s);
  const speakerHead = s.speaker && s.speaker !== "clerk" ? actorHead(s.speaker, s) : null;
  const tx = speakerHead?.x ?? null;
  const spot = speakerHead ? toScreen(cam, { x: speakerHead.x, y: speakerHead.y + 48 }) : { x: 800, y: 420 };

  const witnessAt = (id: string): At => (s.stand === id ? "stand" : id === s.defendantId ? "defendant" : "door");
  const witnessSpot = (id: string): Spot => {
    const at = witnessAt(id);
    if (at === "defendant") return SPOTS.defendant;
    return at === "stand" ? SPOTS.stand : SPOTS.door;
  };

  const mood = (k: string, fallback: Mood = "neutral") => s.moods[k] ?? fallback;
  const pose = (k: string, fallback: Pose = "rest") => s.poses[k] ?? fallback;
  const talkingFor = (k: string) => s.talker === k;

  const witnesses = s.witnessIds.map((id) => {
    const key = `w:${id}`;
    const sp = witnessSpot(id);
    return (
      <Actor
        key={id}
        seed={id}
        design={designFor(id)}
        spot={sp}
        at={witnessAt(id)}
        delay={delays[id] ?? 0}
        mood={mood(key, id === s.defendantId ? "anxious" : "neutral")}
        pose={pose(key, id === s.defendantId && s.stand !== id ? "clasp" : "rest")}
        talking={talkingFor(key)}
        look={s.speaker === key ? lookAt(sp.x, s.speaker === key ? 900 : tx, 0.4) : lookAt(sp.x, tx)}
      />
    );
  });

  const jurors = s.jurorIds.map((id, i) => {
    const seat = JUROR_SEATS[i] ?? JUROR_SEATS[0]!;
    const up = s.jurorsUp[i] ?? false;
    const sp: Spot = { ...seat, sink: up ? 0 : seat.sink };
    return (
      <Actor
        key={id}
        seed={id}
        design={designFor(id)}
        spot={sp}
        mood={mood(`j:${id}`)}
        pose={pose(`j:${id}`, "folded")}
        look={lookAt(seat.x, tx ?? 900, 0.7)}
        hidden={!s.inSession}
        startle={s.startle}
        className="juror"
      />
    );
  });

  return (
    <div className={`court-scene${s.freeze ? " freeze" : ""}`}>
      <div className="camera" style={{ transform: `scale(${cam.z})`, transformOrigin: `${cam.ox}px ${cam.oy}px` }}>
        <svg className="scene-svg" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} width={STAGE_W} height={STAGE_H} aria-hidden>
          <SceneDefs />
          <BackWall />
          <Actor
            seed="judge"
            design={designFor("judge")}
            spot={SPOTS.judge}
            mood={mood("judge", "stern")}
            pose={pose("judge", "folded")}
            talking={talkingFor("judge")}
            look={s.speaker === "judge" ? 0 : lookAt(SPOTS.judge.x, tx, 0.8)}
            hidden={!s.inSession}
            className="judge"
          />
          <Bench judgeName={s.judgeName} />
          <Actor
            seed="clerk"
            design={designFor("clerk")}
            spot={SPOTS.clerk}
            mood={mood("clerk")}
            pose={s.speaker === "clerk" ? "present" : "write"}
            talking={talkingFor("clerk")}
            look={s.speaker === "clerk" ? 0.6 : lookAt(SPOTS.clerk.x, tx)}
          />
          <ClerkDesk />
          <JuryBack />
          <g>{jurors.slice(0, 3)}</g>
          <JuryMid />
          <g>{jurors.slice(3)}</g>
          <JuryFront />
          <g className="witness-layer">{witnesses}</g>
          <DoorLeaf open={doorOpen} />
          <WitnessStand name={s.standName} />
          <Actor
            seed="prosecutor"
            design={designFor("prosecutor")}
            spot={s.up.prosecutor ? SPOTS.prosecutorUp : SPOTS.prosecutor}
            mood={mood("prosecutor", "focused")}
            pose={pose("prosecutor", s.up.prosecutor ? "rest" : "folded")}
            talking={talkingFor("prosecutor")}
            look={s.speaker === "prosecutor" ? -0.5 : lookAt(SPOTS.prosecutor.x, tx)}
            className="counsel"
          />
          <Actor
            seed="player"
            design={designFor("player")}
            spot={s.up.player ? SPOTS.playerUp : SPOTS.player}
            mood={mood("player", "focused")}
            pose={pose("player", s.up.player ? "rest" : "folded")}
            talking={talkingFor("player")}
            look={s.speaker === "player" ? 0.5 : lookAt(SPOTS.player.x, tx)}
            className="counsel"
          />
          <CounselTables />
          <GalleryRail />
          <Haze />
        </svg>
      </div>
      <div
        className={`spotlight${speakerHead ? " on" : ""}`}
        style={{ ["--fx" as string]: `${spot.x}px`, ["--fy" as string]: `${spot.y}px` }}
        aria-hidden
      />
      <div className="vignette" aria-hidden />
      {overlay}
    </div>
  );
}
