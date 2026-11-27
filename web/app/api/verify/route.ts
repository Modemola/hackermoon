import { NextResponse } from "next/server";
import { verifyEndpoint } from "@ark/core";
import { getModel, getFingerprint } from "@/lib/ark";
import { deployments } from "@/lib/deployments";

export async function POST(req: Request) {
  const { modelId, deploymentId, endpoint, sample } = (await req.json()) as {
    modelId: string;
    deploymentId?: string;
    endpoint?: string;
    sample?: number;
  };
  const model = await getModel(modelId);
  if (!model) return NextResponse.json({ error: "unknown model" }, { status: 404 });
  const fp = await getFingerprint(model);
  if (!fp) return NextResponse.json({ error: "this model has no reference fingerprint yet" }, { status: 409 });
  const allow = (process.env.ARK_ALLOW_ENDPOINTS ?? "").split(",").map((s) => s.trim());
  const target = deploymentId ? deployments.get(deploymentId)?.endpoint : endpoint && allow.includes(endpoint) ? endpoint : undefined;
  if (!target) return NextResponse.json({ error: "no running endpoint" }, { status: 404 });
  try {
    const report = await verifyEndpoint({ baseUrl: target }, fp, { sample: Math.min(sample ?? 8, fp.canaries.length) });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
