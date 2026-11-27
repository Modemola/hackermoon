import { notFound } from "next/navigation";
import { getModel, getAttestations, getFingerprint, formatBytes, GATEWAY } from "@/lib/ark";
import { bootEnabled } from "@/lib/deployments";
import ModelConsole from "./ModelConsole";

export const dynamic = "force-dynamic";

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const model = await getModel(id);
  if (!model) notFound();
  const m = model.manifest;
  const [attestations, fp] = await Promise.all([getAttestations(id), getFingerprint(model)]);
  const link = (tx: string) => (
    <a className="mono" href={`${GATEWAY}/${tx}`} target="_blank" rel="noreferrer">
      {tx}
    </a>
  );

  return (
    <div style={{ paddingTop: 32 }}>
      <h1 style={{ margin: "0 0 6px", wordBreak: "break-word" }}>{m.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{m.description}</p>
      <div className="pills" style={{ marginBottom: 24 }}>
        <span className={`pill ${m.tier}`}>{m.tier}</span>
        <span className="pill">{m.license.spdx}</span>
        <span className="pill">publisher: {m.origin.publisher}</span>
        {model.source === "local" && <span className="pill local">not yet on Arweave</span>}
      </div>

      <ModelConsole modelId={id} bootEnabled={bootEnabled()} hasFingerprint={Boolean(fp)} canaries={fp?.canaries.length ?? 0} />

      <div className="two">
        <section className="block">
          <h2>Record</h2>
          <div className="table-scroll">
            <table>
              <tbody>
                <tr>
                  <th>Manifest</th>
                  <td>{model.source === "arweave" ? link(id) : <span className="muted">local draft</span>}</td>
                </tr>
                <tr>
                  <th>Fingerprint</th>
                  <td>
                    {m.fingerprint ? link(m.fingerprint.arweave) : fp ? <span className="muted">local draft</span> : <span className="muted">none</span>}
                    {fp && (
                      <div className="muted" style={{ fontSize: 13 }}>
                        {fp.canaries.length} canaries × {fp.settings.maxTokens} tokens · {fp.producedBy.hardware ?? "unspecified hardware"}
                      </div>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>Source</th>
                  <td>{m.origin.sourceUrl ? <a href={m.origin.sourceUrl}>{m.origin.sourceUrl}</a> : "—"}</td>
                </tr>
                <tr>
                  <th>Runtime</th>
                  <td className="mono">
                    {m.runtime.image} {m.runtime.args.join(" ")} · ≥{m.runtime.minVramGb} GB VRAM
                  </td>
                </tr>
                {m.origin.notes && (
                  <tr>
                    <th>Notes</th>
                    <td>{m.origin.notes}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="block">
          <h2>Files</h2>
          {m.files.map((f) => (
            <div key={f.path} style={{ marginBottom: 12 }}>
              <b>{f.path}</b> <span className="muted">· {formatBytes(f.bytes)}</span>
              <div className="mono muted">sha256 {f.sha256}</div>
              {f.chunks && <div className="muted" style={{ fontSize: 13 }}>{f.chunks.length} chunk(s) on Arweave</div>}
              {f.mirrors?.map((u) => (
                <div key={u} className="mono muted">
                  mirror {u}
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>

      <section className="block">
        <h2>Public ledger · {attestations.length} attestation{attestations.length === 1 ? "" : "s"}</h2>
        {attestations.length === 0 ? (
          <p className="muted">No verifications recorded yet. Boot the model and verify it to write the first one.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Verdict</th>
                  <th>Target</th>
                  <th>Agreement</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {attestations.map((a) => (
                  <tr key={a.id}>
                    <td>{a.checkedAt.slice(0, 10)}</td>
                    <td>
                      <span className={`verdict ${a.verdict}`}>{a.verdict}</span>
                    </td>
                    <td className="mono">{a.target.gpu ?? a.target.market ?? a.target.kind}</td>
                    <td>{(a.metrics.meanAgreement * 100).toFixed(1)}%</td>
                    <td>{link(a.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
