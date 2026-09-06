import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const AGENT = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8787";

export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy("GET", params.path);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  return proxy("POST", params.path, await req.text());
}

async function proxy(method: "GET" | "POST", path: string[], body?: string) {
  const url = `${AGENT}/${path.join("/")}`;
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000)
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return Response.json(
      { error: "agent unreachable from Vercel — Render may be cold-starting" },
      { status: 502 }
    );
  }
}