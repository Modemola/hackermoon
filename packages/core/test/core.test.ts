import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  canonicalJson,
  sha256Hex,
  validateManifest,
  ManifestError,
  chunkRanges,
  scoreCanary,
  compare,
  traceCanary,
  canaryCommitment,
  bootScript,
  jobDefinition,
  makeAttestation,
  type Manifest,
  type Fingerprint,
} from "../src/index.js";

const fakeId = (c: string) => c.repeat(43);

function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    spec: "ark/0.1",
    name: "qwen2.5-0.5b-instruct-q8_0",
    version: "1",
    description: "test",
    license: { spdx: "apache-2.0" },
    origin: { publisher: "Qwen" },
    tier: "anchored",
    files: [{ path: "model.gguf", bytes: 10, sha256: "a".repeat(64), mirrors: ["https://example.com/m.gguf"] }],
    runtime: { engine: "llama.cpp", image: "ghcr.io/ggml-org/llama.cpp:server-cuda", args: ["-c", "2048"], minVramGb: 2 },
    createdAt: "2026-11-27T00:00:00Z",
    ...over,
  };
}

test("canonicalJson sorts keys and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: undefined, c: "x" }] }), '{"a":[2,{"c":"x"}],"b":1}');
  assert.equal(sha256Hex(canonicalJson({ a: 1 })), sha256Hex('{"a":1}'));
});

test("validateManifest accepts a good manifest and lists every error in a bad one", () => {
  assert.doesNotThrow(() => validateManifest(manifest()));
  const bad = manifest({ tier: "preserved", license: { spdx: "llama3" } });
  bad.files[0].path = "../etc/passwd";
  assert.throws(
    () => validateManifest(bad),
    (e: Error) =>
      e instanceof ManifestError &&
      /licence llama3/.test(e.message) &&
      /plain file name/.test(e.message) &&
      /chunks required/.test(e.message),
  );
});

test("validateManifest checks that chunk sizes add up", () => {
  const m = manifest({ tier: "preserved" });
  m.files[0].chunks = [
    { arweave: fakeId("A"), bytes: 4, sha256: "b".repeat(64) },
    { arweave: fakeId("B"), bytes: 5, sha256: "c".repeat(64) },
  ];
  assert.throws(() => validateManifest(m), /sum to 9, expected 10/);
});

test("chunkRanges covers the file exactly", () => {
  assert.deepEqual(chunkRanges(10, 4), [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
    { start: 8, end: 10 },
  ]);
});

const ref: Fingerprint = {
  spec: "ark-fingerprint/0.1",
  method: "ark-greedy/1",
  model: "m",
  settings: { maxTokens: 4, topLogprobs: 5, system: "s" },
  canaries: [
    { prompt: "p1", tokens: ["a", "b", "c", "d"], logprobs: [-0.1, -0.2, -0.3, -0.4] },
    { prompt: "p2", tokens: ["w", "x", "y", "z"], logprobs: [-1, -1, -1, -1] },
  ],
  producedBy: { engine: "llama.cpp" },
  createdAt: "t",
};

test("scoreCanary stops at the first divergence", () => {
  const s = scoreCanary(ref.canaries[0], { prompt: "p1", tokens: ["a", "b", "X", "d"], logprobs: [-0.1, -0.25, -9, -0.4] }, 4);
  assert.equal(s.agreement, 0.5);
  assert.ok(Math.abs(s.meanAbsDelta - 0.025) < 1e-12);
});

test("compare: identical traces verify, divergent traces fail", () => {
  assert.equal(compare(ref, ref.canaries).verdict, "VERIFIED");
  const swapped = ref.canaries.map((c) => ({ ...c, tokens: ["q", ...c.tokens.slice(1)] }));
  const r = compare(ref, swapped);
  assert.equal(r.verdict, "MISMATCH");
  assert.equal(r.meanAgreement, 0);
});

test("compare: same tokens but shifted logprobs fail on delta", () => {
  const shifted = ref.canaries.map((c) => ({ ...c, logprobs: c.logprobs.map((x) => x - 0.2) }));
  assert.equal(compare(ref, shifted).verdict, "MISMATCH");
});

test("traceCanary parses OpenAI-style logprobs and sends greedy settings", async () => {
  let sent: Record<string, unknown> = {};
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ choices: [{ logprobs: { content: [{ token: "Hi", logprob: -0.5 }, { token: "!", logprob: -0.1 }] } }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const t = await traceCanary({ baseUrl: "http://x/", fetchImpl }, "hello", ref.settings);
  assert.deepEqual(t, { prompt: "hello", tokens: ["Hi", "!"], logprobs: [-0.5, -0.1] });
  assert.equal(sent.temperature, 0);
  assert.equal(sent.logprobs, true);
  assert.equal(sent.max_tokens, 4);
});

test("canaryCommitment depends on prompts and salt", () => {
  assert.notEqual(canaryCommitment(["a"], "s1"), canaryCommitment(["a"], "s2"));
  assert.equal(canaryCommitment(["a", "b"], "s"), canaryCommitment(["a", "b"], "s"));
});

test("jobDefinition targets llama.cpp with a health check and VRAM requirement", () => {
  const j = jobDefinition(manifest(), { manifestId: fakeId("M") });
  assert.equal(j.ops[0].args.expose[0].port, 8080);
  assert.equal(j.meta.system_requirements.required_vram, 2);
  assert.match(j.ops[0].args.cmd[0], /sha256sum -c/);
});

test("bootScript refuses shell metacharacters in runtime args", () => {
  assert.throws(() => bootScript(manifest({ runtime: { ...manifest().runtime, args: ["; rm -rf /"] } })), /unsafe/);
});

test("makeAttestation records verdict and metrics", () => {
  const a = makeAttestation(fakeId("M"), fakeId("F"), { kind: "url", endpoint: "http://x" }, compare(ref, ref.canaries));
  assert.equal(a.verdict, "VERIFIED");
  assert.equal(a.metrics.canariesTested, 2);
});

// End-to-end: run the generated boot script against a local "gateway".
async function withGateway(files: Record<string, Buffer>, fn: (url: string) => void | Promise<void>) {
  const srv = createServer((req, res) => {
    const body = files[(req.url ?? "").slice(1)];
    if (!body) return void res.writeHead(404).end();
    res.writeHead(200).end(body);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    srv.close();
  }
}

test("bootScript reassembles chunks, verifies hashes and starts the server", async () => {
  const data = randomBytes(1000);
  const a = data.subarray(0, 600);
  const b = data.subarray(600);
  const m = manifest({
    tier: "preserved",
    files: [
      {
        path: "model.gguf",
        bytes: 1000,
        sha256: sha256Hex(data),
        chunks: [
          { arweave: fakeId("A"), bytes: 600, sha256: sha256Hex(a) },
          { arweave: fakeId("B"), bytes: 400, sha256: sha256Hex(b) },
        ],
      },
    ],
  });
  await withGateway({ [fakeId("A")]: a, [fakeId("B")]: b }, async (gw) => {
    const dir = mkdtempSync(join(tmpdir(), "ark-"));
    const fake = join(dir, "fake-server.sh");
    writeFileSync(fake, '#!/bin/sh\necho "SERVER $@"\n', { mode: 0o755 });
    const { stdout: out } = await run("sh", ["-c", bootScript(m, gw)], {
      env: { ...process.env, ARK_MODEL_DIR: join(dir, "models"), ARK_SERVER_BIN: fake },
    });
    assert.match(out, /ARK: verified model.gguf/);
    assert.match(out, /SERVER -m model.gguf --host 0.0.0.0 --port 8080/);
    assert.deepEqual(readFileSync(join(dir, "models", "model.gguf")), data);
  });
});

test("bootScript aborts with exit 42 when a chunk is tampered with", async () => {
  const data = randomBytes(100);
  const m = manifest({
    tier: "preserved",
    files: [{ path: "model.gguf", bytes: 100, sha256: sha256Hex(data), chunks: [{ arweave: fakeId("A"), bytes: 100, sha256: sha256Hex(data) }] }],
  });
  const tampered = Buffer.from(data);
  tampered[0] ^= 1;
  await withGateway({ [fakeId("A")]: tampered }, async (gw) => {
    const dir = mkdtempSync(join(tmpdir(), "ark-"));
    let code = 0;
    try {
      await run("sh", ["-c", bootScript(m, gw)], {
        env: { ...process.env, ARK_MODEL_DIR: join(dir, "models"), ARK_SERVER_BIN: "/bin/true" },
      });
    } catch (e) {
      code = (e as { code: number }).code;
    }
    assert.equal(code, 42);
  });
});

test("bootScript falls back across mirrors", async () => {
  const data = randomBytes(64);
  const m = manifest({ files: [{ path: "model.gguf", bytes: 64, sha256: sha256Hex(data), mirrors: [] }] });
  await withGateway({ good: data }, async (gw) => {
    m.files[0].mirrors = [`${gw}/missing`, `${gw}/good`];
    const dir = mkdtempSync(join(tmpdir(), "ark-"));
    const { stdout: out } = await run("sh", ["-c", bootScript(m, gw)], {
      env: { ...process.env, ARK_MODEL_DIR: join(dir, "models"), ARK_SERVER_BIN: "/bin/echo" },
    });
    assert.match(out, /verified model.gguf/);
  });
});
