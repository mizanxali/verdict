/**
 * Case loading: YAML -> zod schema -> cross-reference validation.
 * Any problem throws a CaseLoadError listing every issue found.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import type { LoadCase } from "../shared/contracts";
import { CaseFile } from "../shared/types";
import { validateCase } from "./validate";

export { validateCase } from "./validate";

export const DEFAULT_CASE_ID = "calloway";

const CASES_DIR = dirname(fileURLToPath(import.meta.url));

export class CaseLoadError extends Error {
  constructor(
    readonly source: string,
    readonly problems: string[],
  ) {
    super(`Case ${source} is invalid (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "CaseLoadError";
  }
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join("");
}

/** Parses and validates case YAML text. `source` names it in error messages. */
export function parseCase(text: string, source = "(inline)"): CaseFile {
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new CaseLoadError(source, doc.errors.map((e) => `YAML: ${e.message}`));
  }

  const parsed = CaseFile.safeParse(doc.toJS());
  if (!parsed.success) {
    throw new CaseLoadError(
      source,
      parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`),
    );
  }

  const problems = validateCase(parsed.data);
  if (problems.length > 0) throw new CaseLoadError(source, problems);
  return parsed.data;
}

export const loadCase: LoadCase = (id = DEFAULT_CASE_ID) => {
  if (!/^[a-z0-9_-]+$/.test(id)) {
    throw new CaseLoadError(id, [`"${id}" is not a valid case id (lowercase letters, digits, - and _ only).`]);
  }
  const file = join(CASES_DIR, `${id}.yaml`);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new CaseLoadError(`${id}.yaml`, [`No case file found at ${file}.`]);
  }
  const caseFile = parseCase(text, `${id}.yaml`);
  if (caseFile.id !== id) {
    throw new CaseLoadError(`${id}.yaml`, [`File ${id}.yaml declares id "${caseFile.id}"; they must match.`]);
  }
  return caseFile;
};
