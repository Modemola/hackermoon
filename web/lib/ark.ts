import "server-only";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  findRecords,
  fetchJson,
  validateManifest,
  manifestHash,
  type Manifest,
  type Attestation,
  type Fingerprint,
} from "@ark/core";

export const GATEWAY = process.env.ARK_GATEWAY ?? "https://arweave.net";
const LOCAL_DIR = join(process.cwd(), "data", "models");

export interface ModelEntry {
  id: string; // Arweave id, or "local-<sha12>" for manifests not yet published
  source: "arweave" | "local";
  manifest: Manifest;
  owner?: string;
  timestamp?: number;
}

function localModels(): ModelEntry[] {
  if (!existsSync(LOCAL_DIR)) return [];
  return readdirSync(LOCAL_DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const m = validateManifest(JSON.parse(readFileSync(join(LOCAL_DIR, f), "utf8")));
        return [{ id: `local-${manifestHash(m).slice(0, 12)}`, source: "local" as const, manifest: m }];
      } catch {
        return [];
      }
    });
}

export async function listModels(): Promise<{ models: ModelEntry[]; arweaveError?: string }> {
  const local = localModels();
  try {
    const recs = await findRecords("manifest", {}, { gateway: GATEWAY, first: 100 });
    const fetched = await Promise.all(
      recs.map(async (r) => {
        try {
          const m = validateManifest(await fetchJson(r.id, GATEWAY));
          return { id: r.id, source: "arweave" as const, manifest: m, owner: r.owner, timestamp: r.timestamp };
        } catch {
          return null; // skip records that are not valid manifests
        }
      }),
    );
    return { models: [...fetched.filter((x): x is NonNullable<typeof x> => x !== null), ...local] };
  } catch (e) {
    return { models: local, arweaveError: (e as Error).message };
  }
}

export async function getModel(id: string): Promise<ModelEntry | null> {
  if (id.startsWith("local-")) return localModels().find((m) => m.id === id) ?? null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  try {
    return { id, source: "arweave", manifest: validateManifest(await fetchJson(id, GATEWAY)) };
  } catch {
    return null;
  }
}

export async function getFingerprint(m: ModelEntry): Promise<Fingerprint | null> {
  if (m.manifest.fingerprint) {
    try {
      return await fetchJson<Fingerprint>(m.manifest.fingerprint.arweave, GATEWAY);
    } catch {
      /* fall through to local */
    }
  }
  const p = join(process.cwd(), "data", "fingerprints", `${m.manifest.name}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Fingerprint) : null;
}

export async function getAttestations(id: string): Promise<Array<Attestation & { id: string }>> {
  if (id.startsWith("local-")) return [];
  try {
    const recs = await findRecords("attestation", { "Ark-Manifest": id }, { gateway: GATEWAY, first: 50 });
    const out = await Promise.all(
      recs.map(async (r) => {
        try {
          return { ...(await fetchJson<Attestation>(r.id, GATEWAY)), id: r.id };
        } catch {
          return null;
        }
      }),
    );
    return out.filter((x): x is NonNullable<typeof x> => x !== null);
  } catch {
    return [];
  }
}

export function formatBytes(n: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = n;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i ? 1 : 0)} ${u[i]}`;
}
