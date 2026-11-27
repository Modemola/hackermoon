import { createHash } from "node:crypto";

/** Spec identifier written into every manifest. */
export const MANIFEST_SPEC = "ark/0.1";

/** One stored piece of a file. Large files are split so each upload stays small and resumable. */
export interface Chunk {
  /** Arweave transaction / data item id holding these bytes. */
  arweave: string;
  bytes: number;
  sha256: string;
}

export interface ArchivedFile {
  /** File name as the runtime expects it, e.g. "model.gguf". */
  path: string;
  bytes: number;
  /** SHA-256 of the whole file. This is what the runtime checks before serving. */
  sha256: string;
  /** Present when the bytes themselves are preserved on Arweave ("preserved" tier). */
  chunks?: Chunk[];
  /** Other places the same bytes may be fetched from. Integrity still comes from sha256. */
  mirrors?: string[];
}

export interface Runtime {
  engine: "llama.cpp";
  /** Container image, pinned by digest when known. */
  image: string;
  /** Extra llama-server arguments that affect outputs (context size, template...). */
  args: string[];
  /** Minimum VRAM in GB, passed to Nosana as a requirement. */
  minVramGb: number;
}

export interface FingerprintRef {
  /** Arweave id of the public reference fingerprint (see fingerprint.ts). */
  arweave: string;
  sha256: string;
  method: string;
}

export interface Manifest {
  spec: typeof MANIFEST_SPEC;
  name: string;
  version: string;
  description: string;
  license: { spdx: string; url?: string };
  origin: { publisher: string; sourceUrl?: string; retrievedAt?: string; notes?: string };
  /** "anchored": hashes + fingerprint only. "preserved": the weights themselves are on Arweave too. */
  tier: "anchored" | "preserved";
  files: ArchivedFile[];
  runtime: Runtime;
  fingerprint?: FingerprintRef;
  createdAt: string;
}

/** Licences Ark will preserve. Arweave data cannot be deleted, so redistribution must be allowed. */
export const REDISTRIBUTABLE = new Set([
  "apache-2.0",
  "mit",
  "bsd-3-clause",
  "bsd-2-clause",
  "cc-by-4.0",
  "cc-by-sa-4.0",
  "openrail",
  "openrail-m",
]);

/** Deterministic JSON: sorted keys, no whitespace. Hashes and signatures are computed over this. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function manifestHash(m: Manifest): string {
  return sha256Hex(canonicalJson(m));
}

export class ManifestError extends Error {}

const HEX64 = /^[0-9a-f]{64}$/;
const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;

/** Structural validation. Throws ManifestError listing every problem found. */
export function validateManifest(m: unknown): Manifest {
  const errs: string[] = [];
  const x = m as Partial<Manifest>;
  if (!x || typeof x !== "object") throw new ManifestError("manifest is not an object");
  if (x.spec !== MANIFEST_SPEC) errs.push(`spec must be "${MANIFEST_SPEC}"`);
  for (const k of ["name", "version", "description", "createdAt"] as const)
    if (typeof x[k] !== "string" || !x[k]) errs.push(`${k} is required`);
  if (!x.license?.spdx) errs.push("license.spdx is required");
  else if (x.tier === "preserved" && !REDISTRIBUTABLE.has(x.license.spdx.toLowerCase()))
    errs.push(`licence ${x.license.spdx} does not clearly allow permanent redistribution`);
  if (!x.origin?.publisher) errs.push("origin.publisher is required");
  if (x.tier !== "anchored" && x.tier !== "preserved") errs.push('tier must be "anchored" or "preserved"');
  if (!Array.isArray(x.files) || x.files.length === 0) errs.push("files must be a non-empty array");
  else
    x.files.forEach((f, i) => {
      if (!f.path || f.path.includes("/") || f.path.includes("..")) errs.push(`files[${i}].path must be a plain file name`);
      if (!Number.isInteger(f.bytes) || f.bytes <= 0) errs.push(`files[${i}].bytes must be a positive integer`);
      if (!HEX64.test(f.sha256 ?? "")) errs.push(`files[${i}].sha256 must be 64 lowercase hex chars`);
      if (x.tier === "preserved") {
        if (!f.chunks?.length) errs.push(`files[${i}].chunks required for preserved tier`);
        else {
          const total = f.chunks.reduce((s, c) => s + c.bytes, 0);
          if (total !== f.bytes) errs.push(`files[${i}] chunk sizes sum to ${total}, expected ${f.bytes}`);
          f.chunks.forEach((c, j) => {
            if (!ARWEAVE_ID.test(c.arweave)) errs.push(`files[${i}].chunks[${j}].arweave is not an Arweave id`);
            if (!HEX64.test(c.sha256)) errs.push(`files[${i}].chunks[${j}].sha256 invalid`);
          });
        }
      }
      if (x.tier === "anchored" && !f.mirrors?.length && !f.chunks?.length)
        errs.push(`files[${i}] needs at least one mirror or chunk to be bootable`);
    });
  if (x.runtime?.engine !== "llama.cpp") errs.push('runtime.engine must be "llama.cpp"');
  if (!x.runtime?.image) errs.push("runtime.image is required");
  if (!Array.isArray(x.runtime?.args)) errs.push("runtime.args must be an array");
  if (x.fingerprint && !ARWEAVE_ID.test(x.fingerprint.arweave)) errs.push("fingerprint.arweave is not an Arweave id");
  if (errs.length) throw new ManifestError(errs.join("; "));
  return x as Manifest;
}

/** Split a byte length into chunk ranges of at most `size` bytes. */
export function chunkRanges(total: number, size: number): Array<{ start: number; end: number }> {
  if (size <= 0) throw new Error("chunk size must be positive");
  const out = [];
  for (let start = 0; start < total; start += size) out.push({ start, end: Math.min(total, start + size) });
  return out;
}
