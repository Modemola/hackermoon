import { NextResponse } from "next/server";
import { deployments } from "@/lib/deployments";

/** Proxies chat to a running deployment (only ones this server started, so it is not an open relay). */
export async function POST(req: Request) {
  const { deploymentId, endpoint, messages } = (await req.json()) as {
    deploymentId?: string;
    endpoint?: string;
    messages: Array<{ role: string; content: string }>;
  };
  const target = deploymentId ? deployments.get(deploymentId)?.endpoint : allowedDirect(endpoint);
  if (!target) return NextResponse.json({ error: "no running endpoint" }, { status: 404 });
  if (!Array.isArray(messages) || messages.length > 40) return NextResponse.json({ error: "bad messages" }, { status: 400 });
  const res = await fetch(`${target}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "ark", messages, max_tokens: 400, temperature: 0.7 }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return NextResponse.json({ reply: body.choices?.[0]?.message?.content ?? "" }, { status: res.ok ? 200 : 502 });
}

/** In local development you may point the console at your own llama-server. */
function allowedDirect(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  const allow = (process.env.ARK_ALLOW_ENDPOINTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.includes(endpoint) ? endpoint : undefined;
}
