import "server-only";

/**
 * In-memory registry of demo deployments started from this web app.
 * Good enough for a single-instance demo; the source of truth is Nosana itself.
 */
export interface DemoDeployment {
  id: string;
  modelId: string;
  startedAt: number;
  endpoint?: string;
  status: string;
}

const g = globalThis as unknown as { __arkDeployments?: Map<string, DemoDeployment> };
export const deployments: Map<string, DemoDeployment> = (g.__arkDeployments ??= new Map());

export function activeCount(): number {
  let n = 0;
  for (const d of deployments.values()) if (!["STOPPED", "ERROR", "ARCHIVED"].includes(d.status)) n++;
  return n;
}

export const MAX_DEPLOYMENTS = Number(process.env.ARK_MAX_DEPLOYMENTS ?? 2);
export const bootEnabled = () => Boolean(process.env.NOSANA_API_KEY);
