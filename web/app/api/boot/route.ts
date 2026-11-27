import { NextResponse } from "next/server";
import { boot } from "@ark/core";
import { getModel } from "@/lib/ark";
import { deployments, activeCount, MAX_DEPLOYMENTS, bootEnabled } from "@/lib/deployments";

export async function POST(req: Request) {
  if (!bootEnabled()) return NextResponse.json({ error: "Booting is disabled on this server (no Nosana API key)." }, { status: 503 });
  const { modelId, market } = (await req.json()) as { modelId?: string; market?: string };
  if (!modelId) return NextResponse.json({ error: "modelId required" }, { status: 400 });
  if (activeCount() >= MAX_DEPLOYMENTS)
    return NextResponse.json({ error: `Demo limit reached (${MAX_DEPLOYMENTS} models running). Try again shortly.` }, { status: 429 });
  const model = await getModel(modelId);
  if (!model) return NextResponse.json({ error: "unknown model" }, { status: 404 });
  try {
    const r = await boot(model.manifest, {
      apiKey: process.env.NOSANA_API_KEY!,
      market,
      timeoutMinutes: 60,
      manifestId: model.source === "arweave" ? model.id : undefined,
    });
    deployments.set(r.deploymentId, { id: r.deploymentId, modelId, startedAt: Date.now(), status: r.status });
    return NextResponse.json({ deploymentId: r.deploymentId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
