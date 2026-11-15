/**
 * Rendered art (see art/blender): the courtroom layers live in stage/Scene.tsx; these are the
 * props the interface uses. All are WebP with alpha, served from web/public/art.
 */
import type { DocSkin } from "../overlays/Documents";

const BASE = import.meta.env.BASE_URL;
const prop = (name: string) => `${BASE}art/props/${name}.webp`;

export const ART = {
  seal: prop("seal"),
  gavel: prop("gavel"),
  wax: prop("wax"),
  juryRoom: prop("juryroom"),
} as const;

const EXHIBIT: Record<DocSkin, string> = {
  statement: prop("ex_statement"),
  photo: prop("ex_photo"),
  log: prop("ex_log"),
  logbook: prop("ex_logbook"),
  email: prop("ex_email"),
  medical: prop("ex_medical"),
  insurance: prop("ex_insurance"),
  ticket: prop("ex_ticket"),
  generic: prop("ex_generic"),
};

export const exhibitArt = (skin: DocSkin) => EXHIBIT[skin];

/** Ask the browser for every image up front, so nothing pops in mid-scene. */
export function preloadArt(urls: string[]) {
  for (const u of urls) {
    const img = new Image();
    img.decoding = "async";
    img.src = u;
  }
}

export const ALL_PROPS = [...Object.values(ART), ...Object.values(EXHIBIT)];
