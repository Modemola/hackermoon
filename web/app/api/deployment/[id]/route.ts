import { NextResponse } from "next/server";
import { createNosanaClient, NosanaNetwork } from "@nosana/kit";
import { deployments } from "@/lib/deployments";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const local = deployments.get(id);
  if (!local) return NextResponse.json({ error: "unknown deployment" }, { status: 404 });
  try {
    const client = createNosanaClient(NosanaNetwork.MAINNET, { api: { apiKey: process.env.NOSANA_API_KEY! } });
    const d = await client.api!.deployments.get(id);
    local.status = d.status;
    const ep = d.endpoints?.find((e: { online: boolean }) => e.online) as { url: string } | undefined;
    if (ep) {
      const url = ep.url.startsWith("http") ? ep.url : `https://${ep.url}`;
      try {
        const h = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
        if (h.ok) local.endpoint = url;
      } catch {
        /* model still loading */
      }
    }
    return NextResponse.json({ status: d.status, ready: Boolean(local.endpoint), endpoint: local.endpoint ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const local = deployments.get(id);
  if (!local) return NextResponse.json({ error: "unknown deployment" }, { status: 404 });
  const client = createNosanaClient(NosanaNetwork.MAINNET, { api: { apiKey: process.env.NOSANA_API_KEY! } });
  const d = await client.api!.deployments.get(id);
  await d.stop();
  local.status = "STOPPING";
  return NextResponse.json({ ok: true });
}
