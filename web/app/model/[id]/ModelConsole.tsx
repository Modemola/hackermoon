"use client";
import { useEffect, useRef, useState } from "react";

type Verdict = "VERIFIED" | "MISMATCH" | "INCONCLUSIVE";
interface Report {
  verdict: Verdict;
  meanAgreement: number;
  meanAbsDelta: number;
  canariesIdentical: number;
  canaries: unknown[];
}

const LABEL: Record<Verdict, string> = {
  VERIFIED: "✓ Verified genuine",
  MISMATCH: "✗ Mismatch: not the archived model",
  INCONCLUSIVE: "? Inconclusive: re-test with more canaries",
};

export default function ModelConsole(props: { modelId: string; bootEnabled: boolean; hasFingerprint: boolean; canaries: number }) {
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const started = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!deploymentId || ready) return;
    const t = setInterval(async () => {
      setElapsed(Math.round((Date.now() - started.current) / 1000));
      const r = await fetch(`/api/deployment/${deploymentId}`).then((x) => x.json());
      if (r.error) return setError(r.error);
      setStatus(r.status);
      if (r.ready) setReady(true);
    }, 5000);
    return () => clearInterval(t);
  }, [deploymentId, ready]);

  async function bootNow() {
    setError(null);
    setStatus("posting job to Nosana…");
    const r = await fetch("/api/boot", { method: "POST", body: JSON.stringify({ modelId: props.modelId }) }).then((x) => x.json());
    if (r.error) {
      setStatus("idle");
      return setError(r.error);
    }
    started.current = Date.now();
    setDeploymentId(r.deploymentId);
  }

  async function send() {
    if (!input.trim() || !deploymentId) return;
    const next = [...messages, { role: "user" as const, content: input.trim() }];
    setMessages(next);
    setInput("");
    setBusy(true);
    const r = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ deploymentId, messages: next }) }).then((x) => x.json());
    setBusy(false);
    setMessages([...next, { role: "assistant", content: r.reply || r.error || "(no reply)" }]);
  }

  async function verify() {
    setBusy(true);
    setReport(null);
    const r = await fetch("/api/verify", {
      method: "POST",
      body: JSON.stringify({ modelId: props.modelId, deploymentId, sample: Math.min(8, props.canaries) }),
    }).then((x) => x.json());
    setBusy(false);
    if (r.error) return setError(r.error);
    setReport(r);
  }

  async function stopNow() {
    if (!deploymentId) return;
    await fetch(`/api/deployment/${deploymentId}`, { method: "DELETE" });
    setStatus("stopping");
  }

  return (
    <section className="block">
      <h2>Live console</h2>
      {!deploymentId ? (
        <div className="row">
          <button className="btn" onClick={bootNow} disabled={!props.bootEnabled}>
            Boot on Nosana
          </button>
          <span className="muted" style={{ fontSize: 14 }}>
            {props.bootEnabled
              ? "Starts this model on a decentralized GPU. Files are hash-checked before loading."
              : "Booting is disabled on this server. Use the CLI: ark boot <manifest-id>"}
          </span>
        </div>
      ) : (
        <>
          <div className="status">
            deployment {deploymentId} · {status} {ready ? "· endpoint online" : `· ${elapsed}s`}
          </div>
          {ready && (
            <>
              <div className="chat">
                {messages.length === 0 && <p className="muted">Ask the archived model anything.</p>}
                {messages.map((m, i) => (
                  <p key={i} className={`msg ${m.role}`}>
                    <b>{m.role === "user" ? "you" : "model"}:</b> {m.content}
                  </p>
                ))}
                {busy && <p className="muted">…</p>}
              </div>
              <div className="row">
                <input
                  className="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Message"
                />
                <button className="btn" onClick={send} disabled={busy}>
                  Send
                </button>
                <button className="btn ghost" onClick={verify} disabled={busy || !props.hasFingerprint}>
                  Verify this GPU
                </button>
                <button className="btn ghost" onClick={stopNow}>
                  Stop
                </button>
              </div>
            </>
          )}
        </>
      )}
      {report && (
        <div style={{ marginTop: 16 }}>
          <span className={`verdict ${report.verdict}`}>{LABEL[report.verdict]}</span>
          <p className="muted" style={{ fontSize: 14 }}>
            {report.canariesIdentical}/{report.canaries.length} canaries matched token-for-token · mean agreement{" "}
            {(report.meanAgreement * 100).toFixed(1)}% · mean |Δ logprob| {report.meanAbsDelta.toFixed(5)}
          </p>
        </div>
      )}
      {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
    </section>
  );
}
