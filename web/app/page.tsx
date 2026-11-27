import Link from "next/link";
import { listModels, formatBytes } from "@/lib/ark";

export const revalidate = 60;

export default async function Home() {
  const { models, arweaveError } = await listModels();
  return (
    <>
      <div className="hero">
        <h1>AI models that can&apos;t disappear, running on GPUs you can check.</h1>
        <p>
          Ark keeps open models on Arweave permanently. Click Boot and one starts on a stranger&apos;s GPU on Nosana within minutes.
          Then Ark checks the GPU&apos;s answers against the model&apos;s recorded fingerprint, so you know it isn&apos;t running a cheaper copy.
        </p>
      </div>

      <div className="steps">
        <div className="step">
          <b>1 · Archive</b>
          <small>Weights, hashes, licence and runtime settings, stored on Arweave permanently.</small>
        </div>
        <div className="step">
          <b>2 · Boot</b>
          <small>One click starts the model on a Nosana GPU. Each file is checked against its hash before the model loads.</small>
        </div>
        <div className="step">
          <b>3 · Verify</b>
          <small>Hidden test prompts are compared with the reference fingerprint. Swapped quantizations or models fail.</small>
        </div>
        <div className="step">
          <b>4 · Attest</b>
          <small>Every check is saved on Arweave: a permanent public record of which GPUs told the truth.</small>
        </div>
      </div>

      <h2 style={{ fontSize: 15, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>
        The archive · {models.length} model{models.length === 1 ? "" : "s"}
      </h2>
      {arweaveError && <p className="muted">Arweave gateway unreachable ({arweaveError}); showing local manifests only.</p>}
      <div className="grid">
        {models.map((m) => (
          <Link key={m.id} href={`/model/${m.id}`} className="card">
            <h3>{m.manifest.name}</h3>
            <p>{m.manifest.description}</p>
            <div className="pills">
              <span className={`pill ${m.manifest.tier}`}>{m.manifest.tier}</span>
              {m.source === "local" && <span className="pill local">not yet on Arweave</span>}
              <span className="pill">{m.manifest.license.spdx}</span>
              <span className="pill">{formatBytes(m.manifest.files.reduce((s, f) => s + f.bytes, 0))}</span>
              {m.manifest.fingerprint && <span className="pill">fingerprinted</span>}
            </div>
          </Link>
        ))}
        {models.length === 0 && <p className="muted">No models archived yet.</p>}
      </div>
    </>
  );
}
