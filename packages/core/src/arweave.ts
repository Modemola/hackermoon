/**
 * Arweave I/O through ar.io Turbo (uploads) and an ar.io gateway (reads + GraphQL).
 *
 * Small JSON records (manifests, fingerprints, attestations) fit Turbo's free tier
 * (data items up to ~105 KiB at the time of writing). Model weights are paid uploads.
 */
import { createReadStream, statSync, openSync, readSync, closeSync } from "node:fs";
import { TurboFactory } from "@ardrive/turbo-sdk";
import { canonicalJson, sha256Hex, chunkRanges, type Chunk } from "./manifest.js";

export const APP_NAME = "Ark";
export const APP_VERSION = "0.1";
export const DEFAULT_GATEWAY = "https://arweave.net";

export type RecordType = "manifest" | "fingerprint" | "attestation" | "chunk";

export interface Tag {
  name: string;
  value: string;
}

export function arkTags(type: RecordType, extra: Record<string, string> = {}): Tag[] {
  return [
    { name: "App-Name", value: APP_NAME },
    { name: "App-Version", value: APP_VERSION },
    { name: "Ark-Type", value: type },
    ...Object.entries(extra).map(([name, value]) => ({ name, value })),
  ];
}

/** An Arweave JWK (RSA private key in JSON Web Key form). */
export type JWK = Record<string, string>;

export function turboClient(jwk: JWK) {
  return TurboFactory.authenticated({ privateKey: jwk as never });
}

export async function uploadJson(
  jwk: JWK,
  type: RecordType,
  value: unknown,
  extraTags: Record<string, string> = {},
): Promise<{ id: string; sha256: string; bytes: number }> {
  const body = canonicalJson(value);
  const turbo = turboClient(jwk);
  const res = await turbo.upload({
    data: body,
    dataItemOpts: { tags: [{ name: "Content-Type", value: "application/json" }, ...arkTags(type, extraTags)] },
  });
  return { id: res.id, sha256: sha256Hex(body), bytes: Buffer.byteLength(body) };
}

/** Upload a large file as fixed-size chunks. Returns the chunk list for the manifest. */
export async function uploadFileChunks(
  jwk: JWK,
  path: string,
  fileSha256: string,
  chunkBytes = 256 * 1024 * 1024,
  onProgress?: (done: number, total: number) => void,
): Promise<Chunk[]> {
  const total = statSync(path).size;
  const turbo = turboClient(jwk);
  const chunks: Chunk[] = [];
  const ranges = chunkRanges(total, chunkBytes);
  for (const [i, r] of ranges.entries()) {
    const size = r.end - r.start;
    const buf = Buffer.alloc(size);
    const fd = openSync(path, "r");
    readSync(fd, buf, 0, size, r.start);
    closeSync(fd);
    const sha = sha256Hex(buf);
    const res = await turbo.uploadFile({
      fileStreamFactory: () => createReadStream(path, { start: r.start, end: r.end - 1 }),
      fileSizeFactory: () => size,
      dataItemOpts: {
        tags: [
          { name: "Content-Type", value: "application/octet-stream" },
          ...arkTags("chunk", { "Ark-File-Sha256": fileSha256, "Ark-Chunk-Index": String(i), "Ark-Chunk-Sha256": sha }),
        ],
      },
    });
    chunks.push({ arweave: res.id, bytes: size, sha256: sha });
    onProgress?.(r.end, total);
  }
  return chunks;
}

/** Live price quote for storing `bytes` permanently, in USD. */
export async function quoteUsd(bytes: number): Promise<number> {
  const turbo = TurboFactory.unauthenticated();
  const est = await turbo.getFiatEstimateForBytes({ byteCount: bytes, currency: "usd" });
  return Number(est.amount);
}

export async function fetchJson<T>(id: string, gateway = DEFAULT_GATEWAY, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(`${gateway}/${id}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`gateway ${gateway} returned ${res.status} for ${id}`);
  return (await res.json()) as T;
}

export interface FoundRecord {
  id: string;
  owner: string;
  tags: Record<string, string>;
  timestamp?: number;
}

/** Find Ark records by type and optional tag filters via the gateway's GraphQL endpoint. */
export async function findRecords(
  type: RecordType,
  filters: Record<string, string> = {},
  opts: { gateway?: string; first?: number; owners?: string[]; fetchImpl?: typeof fetch } = {},
): Promise<FoundRecord[]> {
  const tags = [
    { name: "App-Name", values: [APP_NAME] },
    { name: "Ark-Type", values: [type] },
    ...Object.entries(filters).map(([name, value]) => ({ name, values: [value] })),
  ];
  const query = `query($tags:[TagFilter!],$first:Int,$owners:[String!]){
    transactions(tags:$tags, first:$first, owners:$owners, sort:HEIGHT_DESC){
      edges{ node{ id owner{address} tags{name value} block{timestamp} } }
    }
  }`;
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${opts.gateway ?? DEFAULT_GATEWAY}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { tags, first: opts.first ?? 50, owners: opts.owners } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`graphql returned ${res.status}`);
  const body = (await res.json()) as {
    data?: { transactions: { edges: Array<{ node: { id: string; owner: { address: string }; tags: Tag[]; block?: { timestamp: number } } }> } };
  };
  return (body.data?.transactions.edges ?? []).map(({ node }) => ({
    id: node.id,
    owner: node.owner.address,
    tags: Object.fromEntries(node.tags.map((t) => [t.name, t.value])),
    timestamp: node.block?.timestamp,
  }));
}
