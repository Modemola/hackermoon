/**
 * Behavioral fingerprints.
 *
 * A fingerprint is what a model does on a fixed set of "canary" prompts under
 * greedy decoding: the chosen token at each step and its log-probability.
 * Different weights (another quantization, a fine-tune, a different model)
 * change those numbers far more than an honest node's floating-point noise does.
 * The thresholds below come from experiments/fingerprint (see RESULTS.md).
 *
 * Everything here talks to an OpenAI-compatible endpoint, so the same check works
 * against llama.cpp server, vLLM or Ollama, on Nosana or anywhere else.
 */
import { sha256Hex, canonicalJson } from "./manifest.js";

export const FINGERPRINT_SPEC = "ark-fingerprint/0.1";
export const METHOD = "ark-greedy/1";

export interface CanaryTrace {
  prompt: string;
  tokens: string[];
  logprobs: number[];
}

export interface Fingerprint {
  spec: typeof FINGERPRINT_SPEC;
  method: typeof METHOD;
  model: string;
  settings: { maxTokens: number; topLogprobs: number; system: string };
  canaries: CanaryTrace[];
  producedBy: { engine: string; image?: string; hardware?: string };
  createdAt: string;
}

export interface CanaryScore {
  prompt: string;
  /** Fraction of maxTokens that matched the reference before the first divergence. */
  agreement: number;
  /** Mean |logprob(reference) - logprob(candidate)| over the agreed prefix. NaN if none agreed. */
  meanAbsDelta: number;
}

export type Verdict = "VERIFIED" | "MISMATCH" | "INCONCLUSIVE";

export interface Policy {
  /** Pass requires mean agreement at least this high... */
  minMeanAgreement: number;
  /** ...and mean |delta logprob| on agreed tokens at most this. */
  maxMeanAbsDelta: number;
  /** Below this agreement, fail outright. Between the two, INCONCLUSIVE (re-test with more canaries). */
  failBelowAgreement: number;
  /** Above this delta, fail outright. */
  failAboveDelta: number;
}

/** Defaults calibrated in experiments/fingerprint/RESULTS.md. */
export const DEFAULT_POLICY: Policy = {
  minMeanAgreement: 0.9,
  maxMeanAbsDelta: 0.02,
  failBelowAgreement: 0.75,
  failAboveDelta: 0.05,
};

export interface Report {
  verdict: Verdict;
  meanAgreement: number;
  meanAbsDelta: number;
  canariesIdentical: number;
  canaries: CanaryScore[];
  policy: Policy;
}

export function scoreCanary(ref: CanaryTrace, cand: CanaryTrace, maxTokens: number): CanaryScore {
  const n = Math.min(ref.tokens.length, cand.tokens.length);
  let agreed = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (ref.tokens[i] !== cand.tokens[i]) break;
    agreed++;
    sum += Math.abs(ref.logprobs[i] - cand.logprobs[i]);
  }
  // A reference that legitimately stopped early (EOS) is fully matched by an identical early stop.
  const denom = Math.max(1, Math.min(maxTokens, Math.max(ref.tokens.length, cand.tokens.length)));
  return { prompt: ref.prompt, agreement: agreed / denom, meanAbsDelta: agreed ? sum / agreed : NaN };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function compare(ref: Fingerprint, cand: CanaryTrace[], policy: Policy = DEFAULT_POLICY): Report {
  const byPrompt = new Map(ref.canaries.map((c) => [c.prompt, c]));
  const scores = cand.map((c) => {
    const r = byPrompt.get(c.prompt);
    if (!r) throw new Error(`candidate canary not in reference: ${c.prompt.slice(0, 40)}`);
    return scoreCanary(r, c, ref.settings.maxTokens);
  });
  const meanAgreement = mean(scores.map((s) => s.agreement));
  const deltas = scores.map((s) => s.meanAbsDelta).filter((d) => !Number.isNaN(d));
  const meanAbsDelta = deltas.length ? mean(deltas) : Infinity;
  let verdict: Verdict;
  if (meanAgreement >= policy.minMeanAgreement && meanAbsDelta <= policy.maxMeanAbsDelta) verdict = "VERIFIED";
  else if (meanAgreement < policy.failBelowAgreement || meanAbsDelta > policy.failAboveDelta) verdict = "MISMATCH";
  else verdict = "INCONCLUSIVE";
  return {
    verdict,
    meanAgreement,
    meanAbsDelta,
    canariesIdentical: scores.filter((s) => s.agreement === 1).length,
    canaries: scores,
    policy,
  };
}

// ---------------------------------------------------------------------------
// Talking to an OpenAI-compatible endpoint

export interface EndpointOptions {
  baseUrl: string; // e.g. https://xyz.node.k8s.prd.nos.ci  (no trailing /v1)
  model?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ChatLogprobContent {
  token: string;
  logprob: number;
}

/** Run one canary greedily and return the trace. */
export async function traceCanary(
  ep: EndpointOptions,
  prompt: string,
  settings: Fingerprint["settings"],
): Promise<CanaryTrace> {
  const f = ep.fetchImpl ?? fetch;
  const res = await f(`${ep.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: ep.model ?? "ark",
      messages: [
        { role: "system", content: settings.system },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      top_k: 1,
      seed: 0,
      max_tokens: settings.maxTokens,
      logprobs: true,
      top_logprobs: settings.topLogprobs,
      stream: false,
    }),
    signal: AbortSignal.timeout(ep.timeoutMs ?? 120_000),
  });
  if (!res.ok) throw new Error(`endpoint returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as {
    choices?: Array<{ logprobs?: { content?: ChatLogprobContent[] } }>;
  };
  const content = body.choices?.[0]?.logprobs?.content;
  if (!content) throw new Error("endpoint did not return logprobs; Ark needs logprobs=true support");
  return { prompt, tokens: content.map((c) => c.token), logprobs: content.map((c) => c.logprob) };
}

export async function makeFingerprint(
  ep: EndpointOptions,
  model: string,
  prompts: string[],
  opts: { maxTokens?: number; topLogprobs?: number; system?: string; producedBy: Fingerprint["producedBy"] },
): Promise<Fingerprint> {
  const settings = {
    maxTokens: opts.maxTokens ?? 32,
    topLogprobs: opts.topLogprobs ?? 5,
    system: opts.system ?? "You are a helpful assistant.",
  };
  const canaries: CanaryTrace[] = [];
  for (const p of prompts) canaries.push(await traceCanary(ep, p, settings));
  return {
    spec: FINGERPRINT_SPEC,
    method: METHOD,
    model,
    settings,
    canaries,
    producedBy: opts.producedBy,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Verify an endpoint against a reference. Canaries are sent in a random order,
 * optionally interleaved with decoy traffic by the caller, so a node cannot
 * tell which requests are being checked.
 */
export async function verifyEndpoint(
  ep: EndpointOptions,
  ref: Fingerprint,
  opts: { sample?: number; policy?: Policy; rng?: () => number } = {},
): Promise<Report> {
  const rng = opts.rng ?? Math.random;
  const pool = [...ref.canaries];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = pool.slice(0, Math.min(opts.sample ?? pool.length, pool.length));
  const traces: CanaryTrace[] = [];
  for (const c of chosen) traces.push(await traceCanary(ep, c.prompt, ref.settings));
  return compare(ref, traces, opts.policy);
}

/**
 * Commitment to a secret canary set: publish this hash before testing, reveal
 * the prompts afterwards, and anyone can check the verifier did not pick
 * canaries after seeing results.
 */
export function canaryCommitment(prompts: string[], salt: string): string {
  return sha256Hex(canonicalJson({ prompts, salt }));
}

export function fingerprintHash(fp: Fingerprint): string {
  return sha256Hex(canonicalJson(fp));
}
