/**
 * Attestations: the permanent public ledger of verification results.
 * Each one says "on this date, this verifier checked this deployment of this
 * archived model and got this verdict", and is stored on Arweave forever.
 */
import type { Report, Verdict } from "./fingerprint.js";

export const ATTESTATION_SPEC = "ark-attestation/0.1";

export interface Attestation {
  spec: typeof ATTESTATION_SPEC;
  manifest: string; // Arweave id
  fingerprint: string; // Arweave id
  target: {
    kind: "nosana" | "url";
    endpoint: string;
    deploymentId?: string;
    market?: string;
    node?: string;
    gpu?: string;
  };
  verdict: Verdict;
  metrics: { meanAgreement: number; meanAbsDelta: number; canariesTested: number; canariesIdentical: number };
  policy: Report["policy"];
  /** sha256 commitment to the canary prompts used, revealed separately when private canaries are used. */
  canaryCommitment?: string;
  checkedAt: string;
}

export function makeAttestation(
  manifest: string,
  fingerprint: string,
  target: Attestation["target"],
  report: Report,
  canaryCommitment?: string,
): Attestation {
  return {
    spec: ATTESTATION_SPEC,
    manifest,
    fingerprint,
    target,
    verdict: report.verdict,
    metrics: {
      meanAgreement: round(report.meanAgreement),
      meanAbsDelta: round(report.meanAbsDelta),
      canariesTested: report.canaries.length,
      canariesIdentical: report.canariesIdentical,
    },
    policy: report.policy,
    canaryCommitment,
    checkedAt: new Date().toISOString(),
  };
}

function round(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x;
}

/** Tags used so attestations can be found per model and per node. */
export function attestationTags(a: Attestation): Record<string, string> {
  const t: Record<string, string> = { "Ark-Manifest": a.manifest, "Ark-Verdict": a.verdict };
  if (a.target.node) t["Ark-Node"] = a.target.node;
  if (a.target.market) t["Ark-Market"] = a.target.market;
  return t;
}
