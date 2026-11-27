"""Behavioral fingerprint separation experiment for Ark.

Question: can we tell, from outputs alone, whether a remote node is serving
the exact archived model, versus a cheaper quantization, a sibling fine-tune,
or a different model -- while tolerating the numerical noise an honest node
produces (different thread counts / batch sizes, standing in for different GPUs)?

Two verifier metrics are measured:

1. API metric (works against any OpenAI-compatible endpoint that returns
   top_logprobs, e.g. llama.cpp server, vLLM, Ollama):
     - prefix agreement: fraction of greedy tokens identical to the reference
       before the first divergence
     - mean |delta logprob| of the chosen token over the agreed prefix
2. Teacher-forced metric (needs prompt-logprob support, e.g. vLLM prompt_logprobs):
     - mean |delta logprob| of the *reference* tokens scored by the candidate,
       over every position (no early stop at divergence)

Usage:
  python run_experiment.py --models-dir DIR --out results.json
"""

import argparse
import json
import os
import statistics
import time

import numpy as np
from llama_cpp import Llama

HERE = os.path.dirname(os.path.abspath(__file__))
SYSTEM = "You are a helpful assistant."
TOKENS = 32
TOPK = 5


def chat(prompt: str) -> str:
    # ChatML: shared by Qwen2.5 and SmolLM2.
    return (
        f"<|im_start|>system\n{SYSTEM}<|im_end|>\n"
        f"<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n"
    )


def log_softmax(x: np.ndarray) -> np.ndarray:
    m = x.max(axis=-1, keepdims=True)
    return x - m - np.log(np.exp(x - m).sum(axis=-1, keepdims=True))


def load(path, threads, batch):
    return Llama(
        model_path=path,
        n_ctx=512,
        n_threads=threads,
        n_batch=batch,
        logits_all=True,
        seed=0,
        verbose=False,
    )


def greedy(llm, prompt):
    """Greedy continuation with top-k logprobs per step (what an API returns)."""
    out = llm.create_completion(
        chat(prompt), max_tokens=TOKENS, temperature=0.0, top_k=1, logprobs=TOPK
    )
    lp = out["choices"][0]["logprobs"]
    return {
        "tokens": lp["tokens"],
        "token_logprobs": lp["token_logprobs"],
        "top_logprobs": lp["top_logprobs"],
    }


def teacher_forced(llm, prompt, ref_text):
    """Score the reference continuation (as text) under this model."""
    p = llm.tokenize(chat(prompt).encode(), add_bos=False, special=True)
    c = llm.tokenize(ref_text.encode(), add_bos=False, special=False)
    llm.reset()
    llm.eval(p + c)
    scores = np.array(llm.scores[: len(p) + len(c)])
    lps = log_softmax(scores[len(p) - 1 : len(p) + len(c) - 1])
    return [float(lps[i, t]) for i, t in enumerate(c)], len(c)


def api_distance(ref, cand):
    n = min(len(ref["tokens"]), len(cand["tokens"]))
    agree = 0
    deltas = []
    for i in range(n):
        if ref["tokens"][i] != cand["tokens"][i]:
            break
        agree += 1
        deltas.append(abs(ref["token_logprobs"][i] - cand["token_logprobs"][i]))
    # An answer that legitimately ends early (EOS) is fully matched by an identical early stop.
    denom = max(1, min(TOKENS, max(len(ref["tokens"]), len(cand["tokens"]))))
    return agree / denom, (statistics.fmean(deltas) if deltas else float("nan"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models-dir", required=True)
    ap.add_argument("--out", default=os.path.join(HERE, "results.json"))
    a = ap.parse_args()
    md = a.models_dir
    canaries = json.load(open(os.path.join(HERE, "canaries.json")))

    ref_file = "qwen2.5-0.5b-instruct-q8_0.gguf"
    # (label, file, threads, batch, honest?)
    conditions = [
        ("honest: same file, 4 threads, batch 512", ref_file, 4, 512, True),
        ("honest: same file, 2 threads, batch 64", ref_file, 2, 64, True),
        ("honest: same file, 1 thread, batch 8", ref_file, 1, 8, True),
        ("swap: fp16 (different precision)", "qwen2.5-0.5b-instruct-fp16.gguf", 4, 512, False),
        ("swap: q6_k quantization", "qwen2.5-0.5b-instruct-q6_k.gguf", 4, 512, False),
        ("swap: q4_k_m quantization", "qwen2.5-0.5b-instruct-q4_k_m.gguf", 4, 512, False),
        ("swap: sibling fine-tune (Qwen2.5-Coder-0.5B q8_0)", "qwen2.5-coder-0.5b-instruct-q8_0.gguf", 4, 512, False),
        ("swap: different model (SmolLM2-360M q8_0)", "smollm2-360m-instruct-q8_0.gguf", 4, 512, False),
    ]

    # Reference fingerprint: archived model, canonical settings.
    t0 = time.time()
    ref_llm = load(os.path.join(md, ref_file), 4, 512)
    ref = []
    for c in canaries:
        g = greedy(ref_llm, c)
        g["text"] = "".join(g["tokens"])
        tf, _ = teacher_forced(ref_llm, c, g["text"])
        g["tf_logprobs"] = tf
        ref.append(g)
    del ref_llm
    print(f"reference fingerprint: {len(ref)} canaries x {TOKENS} tokens in {time.time()-t0:.1f}s")

    results = []
    for label, f, th, b, honest in conditions:
        t0 = time.time()
        llm = load(os.path.join(md, f), th, b)
        rows = []
        for c, r in zip(canaries, ref):
            g = greedy(llm, c)
            agree, dlp = api_distance(r, g)
            tf, n = teacher_forced(llm, c, r["text"])
            if n == len(r["tf_logprobs"]):
                tfd = statistics.fmean(abs(x - y) for x, y in zip(tf, r["tf_logprobs"]))
            else:  # different tokenizer -> different token count
                tfd = float("nan")
            rows.append({"agree": agree, "dlp": dlp, "tf_delta": tfd})
        del llm
        agrees = [x["agree"] for x in rows]
        dlps = [x["dlp"] for x in rows if x["dlp"] == x["dlp"]]
        tfs = [x["tf_delta"] for x in rows if x["tf_delta"] == x["tf_delta"]]
        summary = {
            "label": label,
            "file": f,
            "honest": honest,
            "threads": th,
            "batch": b,
            "mean_prefix_agreement": statistics.fmean(agrees),
            "min_prefix_agreement": min(agrees),
            "canaries_fully_identical": sum(1 for x in agrees if x == 1.0),
            "mean_abs_dlogprob_on_prefix": statistics.fmean(dlps) if dlps else None,
            "teacher_forced_mean_abs_dlogprob": statistics.fmean(tfs) if tfs else None,
            "teacher_forced_max_canary": max(tfs) if tfs else None,
            "teacher_forced_min_canary": min(tfs) if tfs else None,
            "seconds": round(time.time() - t0, 1),
            "per_canary": rows,
        }
        results.append(summary)
        print(
            f"{label:55s} agree={summary['mean_prefix_agreement']:.3f} "
            f"(min {summary['min_prefix_agreement']:.2f}, identical {summary['canaries_fully_identical']}/{len(canaries)}) "
            f"dLP={summary['mean_abs_dlogprob_on_prefix'] if summary['mean_abs_dlogprob_on_prefix'] is not None else float('nan'):.5f} "
            f"TF={summary['teacher_forced_mean_abs_dlogprob'] if summary['teacher_forced_mean_abs_dlogprob'] is not None else float('nan'):.5f}"
        )

    json.dump(
        {"reference": ref_file, "tokens": TOKENS, "topk": TOPK, "canaries": len(canaries), "results": results},
        open(a.out, "w"),
        indent=1,
    )
    print("wrote", a.out)


if __name__ == "__main__":
    main()
