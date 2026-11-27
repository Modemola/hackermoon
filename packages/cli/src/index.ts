#!/usr/bin/env node
/**
 * ark: archive, boot and verify open AI models on Arweave + Nosana.
 *
 *   ark wallet new [--out wallet.json]
 *   ark quote <file>
 *   ark init <model.gguf> --name N --license SPDX --publisher P [--mirror URL]... [--source URL] [--vram GB] [--out manifest.json]
 *   ark preserve <manifest.json> <model.gguf> --wallet W           upload weights to Arweave (paid)
 *   ark fingerprint <manifest.json> --endpoint URL [--canaries F] [--hardware H] [--out fingerprint.json]
 *   ark publish <manifest.json> [--fingerprint F] --wallet W        upload fingerprint + manifest (free tier)
 *   ark job <manifest>                                              print the Nosana job definition
 *   ark boot <manifest> [--market ADDR] [--minutes 60]              needs NOSANA_API_KEY
 *   ark verify <manifest> --endpoint URL [--fingerprint F] [--sample N] [--attest --wallet W]
 *   ark list                                                        archived models on Arweave
 *
 * <manifest> may be a local file or an Arweave id.
 */
import { readFileSync, writeFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  validateManifest,
  manifestHash,
  sha256Hex,
  canonicalJson,
  type Manifest,
  type Fingerprint,
  makeFingerprint,
  verifyEndpoint,
  fingerprintHash,
  uploadJson,
  uploadFileChunks,
  fetchJson,
  findRecords,
  quoteUsd,
  jobDefinition,
  boot,
  waitForEndpoint,
  makeAttestation,
  attestationTags,
  generateWallet,
  walletAddress,
  DEFAULT_IMAGE,
  MANIFEST_SPEC,
  type JWK,
} from "@ark/core";

type Flags = Record<string, string | boolean | string[]>;

function parse(argv: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const k = a.slice(2);
    const next = argv[i + 1];
    const v = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (k === "mirror") flags.mirror = [...((flags.mirror as string[]) ?? []), String(v)];
    else flags[k] = v;
  }
  return { pos, flags };
}

const str = (f: Flags, k: string, def?: string): string => {
  const v = f[k];
  if (typeof v === "string") return v;
  if (def !== undefined) return def;
  throw new Error(`--${k} is required`);
};

const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;

async function loadJson<T>(ref: string): Promise<T> {
  if (existsSync(ref)) return JSON.parse(readFileSync(ref, "utf8")) as T;
  if (ARWEAVE_ID.test(ref)) return fetchJson<T>(ref);
  throw new Error(`not a file or Arweave id: ${ref}`);
}

function loadWallet(f: Flags): JWK {
  const p = str(f, "wallet", process.env.ARK_WALLET ?? "");
  if (!p) throw new Error("--wallet (or ARK_WALLET) is required");
  return JSON.parse(readFileSync(p, "utf8")) as JWK;
}

async function fileSha256(path: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((res, rej) =>
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("end", () => res())
      .on("error", rej),
  );
  return h.digest("hex");
}

const out = (o: unknown) => console.log(typeof o === "string" ? o : JSON.stringify(o, null, 2));
const save = (path: string, o: unknown) => {
  writeFileSync(path, JSON.stringify(o, null, 2) + "\n");
  console.error(`wrote ${path}`);
};

const DEFAULT_CANARIES = [
  "Explain in two sentences why the sky appears blue.",
  "Write a haiku about a lighthouse in winter.",
  "What is 17 multiplied by 23? Show your reasoning briefly.",
  "Write a Python function that reverses a string.",
  "Summarize the plot of Romeo and Juliet in one sentence.",
  "Explain what a hash function is to a ten-year-old.",
  "Convert 72 degrees Fahrenheit to Celsius.",
  "Write a SQL query that counts rows in a table named orders.",
  "Explain recursion using an example that is not factorial.",
  "What does the acronym GPU stand for and what is it used for?",
  "Describe a sunset on Mars.",
  "Give one argument for and one against remote work.",
];

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);

  switch (cmd) {
    case "wallet": {
      if (pos[0] !== "new") throw new Error("usage: ark wallet new [--out wallet.json]");
      const path = str(flags, "out", "wallet.json");
      if (existsSync(path)) throw new Error(`${path} exists; refusing to overwrite a wallet`);
      const jwk = generateWallet();
      writeFileSync(path, JSON.stringify(jwk), { mode: 0o600 });
      out({ wallet: path, address: walletAddress(jwk) });
      return;
    }

    case "quote": {
      const bytes = statSync(pos[0]).size;
      const usd = await quoteUsd(bytes);
      out({ file: pos[0], bytes, usd: Math.round(usd * 100) / 100 });
      return;
    }

    case "init": {
      const file = pos[0];
      if (!file) throw new Error("usage: ark init <model.gguf> --name ... --license ... --publisher ...");
      console.error(`hashing ${file}...`);
      const m: Manifest = {
        spec: MANIFEST_SPEC,
        name: str(flags, "name"),
        version: str(flags, "version", "1"),
        description: str(flags, "description", ""),
        license: { spdx: str(flags, "license"), url: typeof flags["license-url"] === "string" ? flags["license-url"] : undefined },
        origin: {
          publisher: str(flags, "publisher"),
          sourceUrl: typeof flags.source === "string" ? flags.source : undefined,
          retrievedAt: new Date().toISOString(),
          notes: typeof flags.notes === "string" ? flags.notes : undefined,
        },
        tier: "anchored",
        files: [
          {
            path: str(flags, "path", basename(file)),
            bytes: statSync(file).size,
            sha256: await fileSha256(file),
            mirrors: (flags.mirror as string[]) ?? [],
          },
        ],
        runtime: {
          engine: "llama.cpp",
          image: str(flags, "image", DEFAULT_IMAGE),
          args: ["-c", str(flags, "ctx", "4096")],
          minVramGb: Number(str(flags, "vram", "4")),
        },
        createdAt: new Date().toISOString(),
      };
      if (!m.description) m.description = `${m.name} (${m.license.spdx}) archived by Ark`;
      validateManifest(m);
      save(str(flags, "out", "manifest.json"), m);
      return;
    }

    case "preserve": {
      const [mpath, file] = pos;
      const m = validateManifest(JSON.parse(readFileSync(mpath, "utf8")));
      const sha = await fileSha256(file);
      if (sha !== m.files[0].sha256) throw new Error("file does not match the manifest hash");
      const usd = await quoteUsd(statSync(file).size);
      console.error(`permanent storage quote: $${usd.toFixed(2)}`);
      if (!flags.yes) throw new Error("re-run with --yes to pay for and upload the weights");
      const chunks = await uploadFileChunks(loadWallet(flags), file, sha, undefined, (d, t) =>
        console.error(`uploaded ${((100 * d) / t).toFixed(1)}%`),
      );
      m.files[0].chunks = chunks;
      m.tier = "preserved";
      save(mpath, validateManifest(m));
      return;
    }

    case "fingerprint": {
      const m = validateManifest(await loadJson(pos[0]));
      const prompts = typeof flags.canaries === "string" ? (JSON.parse(readFileSync(flags.canaries, "utf8")) as string[]) : DEFAULT_CANARIES;
      const fp = await makeFingerprint({ baseUrl: str(flags, "endpoint") }, m.name, prompts, {
        producedBy: { engine: "llama.cpp", image: m.runtime.image, hardware: str(flags, "hardware", "unspecified") },
      });
      save(str(flags, "out", "fingerprint.json"), fp);
      out({ canaries: fp.canaries.length, sha256: fingerprintHash(fp) });
      return;
    }

    case "publish": {
      const jwk = loadWallet(flags);
      const m = validateManifest(JSON.parse(readFileSync(pos[0], "utf8")));
      if (typeof flags.fingerprint === "string") {
        const fp = JSON.parse(readFileSync(flags.fingerprint, "utf8")) as Fingerprint;
        const up = await uploadJson(jwk, "fingerprint", fp, { "Ark-Model": m.name });
        m.fingerprint = { arweave: up.id, sha256: up.sha256, method: fp.method };
        console.error(`fingerprint -> ${up.id} (${up.bytes} bytes)`);
      }
      const up = await uploadJson(jwk, "manifest", m, { "Ark-Model": m.name, "Ark-Tier": m.tier, "Ark-License": m.license.spdx });
      save(pos[0], m);
      out({ manifest: up.id, sha256: manifestHash(m), url: `https://arweave.net/${up.id}` });
      return;
    }

    case "job": {
      const m = validateManifest(await loadJson(pos[0]));
      out(jobDefinition(m, { manifestId: ARWEAVE_ID.test(pos[0]) ? pos[0] : undefined }));
      return;
    }

    case "boot": {
      const apiKey = process.env.NOSANA_API_KEY;
      if (!apiKey) throw new Error("set NOSANA_API_KEY (create one in the Nosana dashboard)");
      const m = validateManifest(await loadJson(pos[0]));
      const r = await boot(m, {
        apiKey,
        market: typeof flags.market === "string" ? flags.market : undefined,
        timeoutMinutes: Number(str(flags, "minutes", "60")),
        manifestId: ARWEAVE_ID.test(pos[0]) ? pos[0] : undefined,
      });
      console.error(`deployment ${r.deploymentId} ${r.status}; waiting for endpoint...`);
      const url = await waitForEndpoint(r.deploymentId, { apiKey, onStatus: (s) => console.error(`  status ${s}`) });
      out({ deployment: r.deploymentId, endpoint: url });
      return;
    }

    case "verify": {
      const mref = pos[0];
      const m = validateManifest(await loadJson(mref));
      const fpRef = typeof flags.fingerprint === "string" ? flags.fingerprint : m.fingerprint?.arweave;
      if (!fpRef) throw new Error("no fingerprint: pass --fingerprint or publish one with the manifest");
      const fp = await loadJson<Fingerprint>(fpRef);
      if (m.fingerprint && fpRef === m.fingerprint.arweave && sha256Hex(canonicalJson(fp)) !== m.fingerprint.sha256)
        throw new Error("fingerprint does not match the hash recorded in the manifest");
      const endpoint = str(flags, "endpoint");
      const report = await verifyEndpoint({ baseUrl: endpoint }, fp, {
        sample: typeof flags.sample === "string" ? Number(flags.sample) : undefined,
      });
      const summary = {
        verdict: report.verdict,
        meanAgreement: report.meanAgreement,
        meanAbsDelta: report.meanAbsDelta,
        canariesIdentical: `${report.canariesIdentical}/${report.canaries.length}`,
      };
      out(summary);
      if (flags.attest) {
        if (!ARWEAVE_ID.test(mref) || !m.fingerprint) throw new Error("--attest needs a published manifest id");
        const a = makeAttestation(mref, m.fingerprint.arweave, {
          kind: endpoint.includes("nos.ci") ? "nosana" : "url",
          endpoint,
          deploymentId: typeof flags.deployment === "string" ? flags.deployment : undefined,
          market: typeof flags.market === "string" ? flags.market : undefined,
          gpu: typeof flags.gpu === "string" ? flags.gpu : undefined,
        }, report);
        const up = await uploadJson(loadWallet(flags), "attestation", a, attestationTags(a));
        out({ attestation: up.id, url: `https://arweave.net/${up.id}` });
      }
      process.exitCode = report.verdict === "VERIFIED" ? 0 : report.verdict === "MISMATCH" ? 2 : 3;
      return;
    }

    case "list": {
      const recs = await findRecords("manifest", {}, { first: Number(str(flags, "first", "50")) });
      for (const r of recs) console.log(`${r.id}  ${r.tags["Ark-Model"] ?? "?"}  ${r.tags["Ark-Tier"] ?? ""}  ${r.tags["Ark-License"] ?? ""}`);
      return;
    }

    default:
      console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0].replace(/^#!.*\n\/\*\*?/, "").replace(/^ \* ?/gm, ""));
      if (cmd && cmd !== "help") process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(`ark: ${e.message}`);
  process.exit(1);
});
