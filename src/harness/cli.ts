/** Small helpers shared by the driver and regress command lines. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

export const defaultIo: Io = { out: (s) => console.log(s), err: (s) => console.error(s) };

export function intFlag(name: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new Error(`--${name} must be a whole number, got "${v}"`);
  return Number(v);
}

/** Runs main() when the file is the entry point (tsx src/harness/x.ts), not when imported. */
export function runIfMain(metaUrl: string, main: (argv: string[]) => Promise<number>): void {
  if (!process.argv[1] || metaUrl !== pathToFileURL(resolve(process.argv[1])).href) return;
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
