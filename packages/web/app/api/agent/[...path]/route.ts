import http from "node:http";
import https from "node:https";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const AGENT = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8787";

function upstream(
  method: "GET" | "POST",
  path: string[],
  body?: string
): Promise<{ status: number; contentType: string | null; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(`${AGENT}/${path.join("/")}`);
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      u,
      {
        method,
        family: 4,
        timeout: 60_000,
        headers:
          body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
              }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 502,
            contentType: res.headers["content-type"] ?? null,
            text: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("upstream timeout after 60s")));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

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
  try {
    const res = await upstream(method, path, body);
    return new Response(res.text, {
      status: res.status,
      headers: {
        "Content-Type": res.contentType ?? "application/json",
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return Response.json(
      { error: "agent unreachable from Vercel (render cold-start or IPv6 egress)" },
      { status: 502 }
    );
  }
}