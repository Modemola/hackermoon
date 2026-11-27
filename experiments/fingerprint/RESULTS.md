# Results (CPU, 27 Nov 2026)

Reference: Qwen2.5-0.5B-Instruct `q8_0`. 24 canaries × 32 greedy tokens. llama-cpp-python 0.3.38, x86-64, 4 cores.

| Condition | Mean agreement | Canaries identical | Mean \|Δ logprob\| (API) | Teacher-forced \|Δ\| |
|---|---|---|---|---|
| Honest: same file, 4 threads, batch 512 | **1.000** | 24/24 | **0.00000** | 0.00000 |
| Honest: same file, 2 threads, batch 64 | **1.000** | 24/24 | **0.00000** | 0.00000 |
| Honest: same file, 1 thread, batch 8 | **1.000** | 24/24 | **0.00019** | 0.00000 |
| Swap: fp16 (more precise than the original) | 0.907 | 19/24 | 0.02523 | 0.02561 |
| Swap: q6_k | 0.757 | 14/24 | 0.02635 | 0.03209 |
| Swap: q4_k_m | 0.577 | 8/24 | 0.07559 | 0.10007 |
| Swap: sibling fine-tune (Qwen2.5-Coder-0.5B q8_0) | 0.155 | 0/24 | 0.23087 | 0.75709 |
| Swap: different model (SmolLM2-360M q8_0) | 0.076 | 0/24 | 0.22339 | 0.74083 |

## What this shows

- **Honest noise is tiny.** Changing thread count and batch size changes the order of floating-point accumulation. Even so, greedy output stayed identical on all 24 canaries, and log-probabilities moved by at most 0.0002.
- **Every substitution is detectable.** The hardest case is fp16, which is a *better* copy of the same model, and its Δ is still 0.025. That is **about 130× the honest worst case**. The token-agreement metric on its own would have missed it: 19 of 24 canaries were still identical. That is why Ark uses logprobs and not text alone.
- **Fine-tunes and other models are trivial to catch.** Agreement is ≤ 0.16 and Δ is ≥ 0.22.

## End-to-end check with the real CLI and llama-server

Fingerprinted with `ark fingerprint` against llama.cpp `llama-server` (a07831a) serving q8_0, then verified with `ark verify`:

| Target | Verdict | Identical | Mean \|Δ\| | Exit code |
|---|---|---|---|---|
| Genuine q8_0 server | VERIFIED | 12/12 | 0 | 0 |
| Impostor q4_k_m server | MISMATCH | 4/12 | 0.066 | 2 |
| Simulated Nosana node (generated boot script: fetched 675 MB from the mirror, SHA-256 checked, 12 s to healthy) | VERIFIED | 12/12 | 0 | 0 |

## Policy (provisional)

Defaults in `packages/core/src/fingerprint.ts`:
- **VERIFIED**: agreement ≥ 0.95 and Δ ≤ 0.005.
- **MISMATCH**: agreement < 0.85 or Δ > 0.015.
- Anything in between is **INCONCLUSIVE**, so the verifier re-tests with more canaries.

That puts honest CPU runs 25× below the pass line, and the closest substitution (fp16) 1.7× above the fail line.

## Not yet measured, and the next experiment

GPU kernels (CUDA on different cards, flash-attention on or off, concurrent requests batched together) add more noise than CPU threading does. The next run uses Nosana credits:

1. Boot the same manifest on 5+ GPU types: 3060, 4070, 4090, A5000 and A100. At current market prices that costs under $1 in total.
2. Fingerprint each GPU against the CPU reference and against each other.
3. Repeat with 4 concurrent requests per node.
4. Re-fit the thresholds. If cross-GPU noise approaches the fp16 gap, switch to **per-hardware-class reference fingerprints**: anyone can produce one from the permanent weights.
