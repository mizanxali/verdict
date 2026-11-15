import type { PlayerAction, PlayerView } from "../../src/shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("Cannot reach the court server. Is it running on port 8787?", 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status}).`, res.status);
  return body;
}

export const api = {
  createTrial: () => request<{ trialId: string; view: PlayerView }>("/api/trials", { method: "POST", body: "{}" }),
  getTrial: (id: string) => request<{ view: PlayerView }>(`/api/trials/${encodeURIComponent(id)}`),
  act: (id: string, action: PlayerAction) =>
    request<{ accepted: true }>(`/api/trials/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      body: JSON.stringify(action),
    }),
  eventsUrl: (id: string) => `/api/trials/${encodeURIComponent(id)}/events`,
};

export const MAX_TEXT = 1200;
