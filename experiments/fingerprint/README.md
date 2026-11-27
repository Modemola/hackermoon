# Fingerprint separation experiment

**Question.** From outputs alone, can a verifier tell whether a remote node is serving the exact archived weights, or a substitute? The substitutes tested are a different precision, a cheaper quantization, a sibling fine-tune, and a different model. The verifier also has to tolerate the numerical noise an honest node produces.

**Setup.**
- Reference ("archived") model: Qwen2.5-0.5B-Instruct `q8_0`.
- 24 canary prompts (`canaries.json`), ChatML system prompt, greedy decoding, 32 tokens, top-5 logprobs.
- Honest variation: same file with different thread counts (4/2/1) and batch sizes (512/64/8). These change the order of floating-point accumulation.
- Metrics:
  - **API metric**: works with any OpenAI-compatible endpoint. Agreement is the fraction of greedy tokens that match before the first divergence. Δ is the mean |logprob difference| of the chosen token over the matching prefix.
  - **Teacher-forced metric**: the candidate scores the reference continuation, and we take the mean |Δ logprob| over every position. This needs prompt-logprob support, such as vLLM's `prompt_logprobs`.

**Models** (all Apache-2.0, from Hugging Face):

| File | SHA-256 |
|---|---|
| `Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q8_0.gguf` | `ca59ca7f13d0e15a8cfa77bd17e65d24f6844b554a7b6c12e07a5f89ff76844e` |
| `Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-fp16.gguf` | `8e0ae26000627ed62de0e78e41860af70094558b9d2913385c842a6aa06cf3fc` |
| `Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q6_k.gguf` | `2f82233630c349ccf6b8daccf48f9a7865713d9f08a2eadfa456cebe9b97c7f5` |
| `Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-q4_k_m.gguf` | `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` |
| `Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/qwen2.5-coder-0.5b-instruct-q8_0.gguf` | `e1a77721fa97d412f121878223eec81fb4ae6f271e18f922d746711f67b344d1` |
| `HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/smollm2-360m-instruct-q8_0.gguf` | `48ab3034d0dd401fbc721eb1df3217902fee7dab9078992d66431f09b7750201` |

**Run.**

```bash
python -m venv .venv && .venv/bin/pip install llama-cpp-python==0.3.38 numpy
mkdir models && cd models
for f in Qwen/Qwen2.5-0.5B-Instruct-GGUF/qwen2.5-0.5b-instruct-{q8_0,fp16,q6_k,q4_k_m}.gguf \
         Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/qwen2.5-coder-0.5b-instruct-q8_0.gguf \
         HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/smollm2-360m-instruct-q8_0.gguf; do
  curl -LO "https://huggingface.co/${f%/*}/resolve/main/${f##*/}"; done
cd .. && .venv/bin/python run_experiment.py --models-dir models
```

Results: [`RESULTS.md`](RESULTS.md) and raw per-canary data in `results.json`.
