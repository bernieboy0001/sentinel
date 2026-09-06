import type { AppState } from "./types";

export const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8787";

export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL || "https://sepolia.basescan.org";

const API_BASE =
  typeof window !== "undefined"
    ? `${window.location.origin}/api/agent`
    : "http://localhost:8787";

export function txLink(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export async function fetchState(): Promise<AppState> {
  const r = await fetch(`${API_BASE}/state`, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} from the agent bridge`);
  return (await r.json()) as AppState;
}

export async function humanVeto(decisionId: string): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/human-veto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisionId })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export type InspectResult =
  | { ok: true; data: import("./types").InspectionResult }
  | { ok: false; error: string };

export async function inspectTarget(target: string): Promise<InspectResult> {
  try {
    const r = await fetch(`${API_BASE}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target })
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${r.status}` };
    }
    return { ok: true, data: (await r.json()) as import("./types").InspectionResult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}