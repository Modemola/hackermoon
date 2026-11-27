/**
 * Booting an archived model on Nosana.
 *
 * The job uses the stock llama.cpp server image and a generated shell script that
 * pulls every file from Arweave (or a mirror), checks each SHA-256 against the
 * manifest, and only then starts the server. No custom image is needed, so the
 * whole boot procedure is visible in the job definition itself.
 */
import { createNosanaClient, NosanaNetwork } from "@nosana/kit";
import type { Manifest } from "./manifest.js";
import { DEFAULT_GATEWAY } from "./arweave.js";

export const DEFAULT_IMAGE = "ghcr.io/ggml-org/llama.cpp:server-cuda";
export const SERVER_PORT = 8080;

/** Single-quote a value for POSIX sh. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

const SAFE_ARG = /^[A-Za-z0-9_.,:=+\-/]+$/;

/** Shell script that fetches, verifies and serves the model. Exits non-zero on any hash mismatch. */
export function bootScript(m: Manifest, gateway = DEFAULT_GATEWAY): string {
  for (const a of m.runtime.args) if (!SAFE_ARG.test(a)) throw new Error(`unsafe runtime arg: ${a}`);
  const L: string[] = [
    "set -eu",
    'mkdir -p "${ARK_MODEL_DIR:-/models}" && cd "${ARK_MODEL_DIR:-/models}"',
    'fetch() { curl -fsSL --retry 5 --retry-delay 3 --connect-timeout 20 "$1" -o "$2"; }',
    'check() { echo "$1  $2" | sha256sum -c - >/dev/null || { echo "ARK: SHA-256 MISMATCH for $2" >&2; exit 42; }; }',
  ];
  for (const f of m.files) {
    const name = shq(f.path);
    L.push(`echo "ARK: fetching ${f.path} (${f.bytes} bytes)"`);
    if (f.chunks?.length) {
      L.push(`: > ${name}`);
      f.chunks.forEach((c, i) => {
        L.push(`fetch ${shq(`${gateway}/${c.arweave}`)} part.${i}`);
        L.push(`check ${c.sha256} part.${i}`);
        L.push(`cat part.${i} >> ${name} && rm part.${i}`);
      });
    } else if (f.mirrors?.length) {
      const tries = f.mirrors.map((u) => `fetch ${shq(u)} ${name}`).join(" || ");
      L.push(`${tries} || { echo "ARK: no source reachable for ${f.path}" >&2; exit 43; }`);
    } else {
      throw new Error(`file ${f.path} has no chunks or mirrors`);
    }
    L.push(`check ${f.sha256} ${name}`);
    L.push(`echo "ARK: verified ${f.path} sha256=${f.sha256}"`);
  }
  const model = shq(m.files[0].path);
  L.push(
    `exec "\${ARK_SERVER_BIN:-/app/llama-server}" -m ${model} --host 0.0.0.0 --port ${SERVER_PORT} -ngl 999 --alias ${shq(m.name)} ${m.runtime.args.map(shq).join(" ")}`.trim(),
  );
  return L.join("\n");
}

export function jobDefinition(m: Manifest, opts: { gateway?: string; manifestId?: string } = {}) {
  return {
    version: "0.1",
    type: "container",
    meta: {
      trigger: "api",
      system_requirements: { required_vram: m.runtime.minVramGb },
      ark: { manifest: opts.manifestId ?? null, model: m.name },
    },
    ops: [
      {
        type: "container/run",
        id: "ark-model",
        args: {
          image: m.runtime.image || DEFAULT_IMAGE,
          entrypoint: ["/bin/sh", "-c"],
          cmd: [bootScript(m, opts.gateway)],
          gpu: true,
          expose: [
            {
              port: SERVER_PORT,
              type: "api",
              health_checks: [
                { type: "http", path: "/health", method: "GET", expected_status: 200, continuous: false },
              ],
            },
          ],
        },
      },
    ],
  };
}

export interface BootResult {
  deploymentId: string;
  status: string;
  endpoint?: string;
}

/** Create and start a Nosana deployment using account credits (API key). */
export async function boot(
  m: Manifest,
  opts: { apiKey: string; market?: string; timeoutMinutes?: number; manifestId?: string; name?: string },
): Promise<BootResult> {
  const client = createNosanaClient(NosanaNetwork.MAINNET, { api: { apiKey: opts.apiKey } });
  if (!client.api) throw new Error("Nosana API unavailable: check the API key");
  const dep = await client.api.deployments.create({
    name: opts.name ?? `ark-${m.name}`.slice(0, 60),
    market: opts.market,
    timeout: Math.max(60, opts.timeoutMinutes ?? 60),
    replicas: 1,
    strategy: "SIMPLE",
    job_definition: jobDefinition(m, { manifestId: opts.manifestId }) as never,
  } as never);
  await dep.start();
  return { deploymentId: dep.id, status: dep.status };
}

/** Poll until the deployment exposes an online endpoint, or time out. */
export async function waitForEndpoint(
  deploymentId: string,
  opts: { apiKey: string; timeoutMs?: number; intervalMs?: number; onStatus?: (s: string) => void },
): Promise<string> {
  const client = createNosanaClient(NosanaNetwork.MAINNET, { api: { apiKey: opts.apiKey } });
  if (!client.api) throw new Error("Nosana API unavailable");
  const until = Date.now() + (opts.timeoutMs ?? 15 * 60_000);
  while (Date.now() < until) {
    const d = await client.api.deployments.get(deploymentId);
    opts.onStatus?.(d.status);
    if (["ERROR", "STOPPED", "INSUFFICIENT_FUNDS", "ARCHIVED"].includes(d.status))
      throw new Error(`deployment ended with status ${d.status}`);
    const ep = d.endpoints?.find((e: { online: boolean; url: string }) => e.online);
    if (ep) {
      const url = ep.url.startsWith("http") ? ep.url : `https://${ep.url}`;
      try {
        const h = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) });
        if (h.ok) return url;
      } catch {
        /* not ready yet */
      }
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 10_000));
  }
  throw new Error("timed out waiting for the model endpoint");
}

export async function stop(deploymentId: string, apiKey: string): Promise<void> {
  const client = createNosanaClient(NosanaNetwork.MAINNET, { api: { apiKey } });
  const d = await client.api!.deployments.get(deploymentId);
  await d.stop();
}
