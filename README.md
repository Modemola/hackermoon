# Ark

**AI models that can't disappear, running on GPUs you can check.**

Ark is a permanent archive of open AI models on [Arweave](https://arweave.org). Any model in it boots on a decentralized GPU on [Nosana](https://nosana.com) with one command. Ark then checks, from the model's answers alone, that the stranger's GPU is running *exactly* the archived weights and not a cheaper quantization or a different model.

Built for the [Decentralize AI Hackathon](https://decentralizeai.tech) (HackerNoon × Nosana × Arweave × MEXC).

```
archive ──▶ Arweave (manifest + hashes + licence + runtime + fingerprint, permanent)
boot    ──▶ Nosana job: stock llama.cpp image, fetch from Arweave, SHA-256 every file, serve
verify  ──▶ canary prompts → compare tokens + logprobs to the fingerprint → VERIFIED / MISMATCH
attest  ──▶ verdict written back to Arweave: a public, permanent ledger of honest GPUs
```

## Why

1. **Models disappear.** Microsoft deleted WizardLM-2 within about a day of release in April 2024. Runway removed Stable Diffusion 1.5 from Hugging Face in August 2024. Projects broke, and only unverified mirrors survived.
2. **Hashes can't see inside a remote GPU.** Registries such as ModelSeal, ModelProof and OpenWeightHub prove which bytes *should* run. None of them can tell you what a node is *actually* serving. As one hackathon entry put it: *"A hash on Arweave says nothing about which weights that server loaded, or whether it quietly swapped in a cheaper quantization."* Ark checks this from behaviour, using any OpenAI-compatible endpoint.

## Evidence: the fingerprint separates honest nodes from substitutions

`experiments/fingerprint` runs the archived model (Qwen2.5-0.5B-Instruct q8_0) and several substitutes on 24 canary prompts × 32 greedy tokens. The table shows the mean |Δ logprob| of the chosen token, compared with the reference:

| Condition | API metric | Teacher-forced |
|---|---|---|
| Honest: same file, 4 threads / batch 512 | 0.00000 | 0.00000 |
| Honest: same file, 2 threads / batch 64 | 0.00000 | 0.00000 |
| Honest: same file, 1 thread / batch 8 | 0.00019 | 0.00000 |
| Swap: fp16 (higher precision!) | 0.02523 | 0.02561 |
| Swap: q6_k | 0.02635 | 0.03209 |
| Swap: q4_k_m | 0.07559 | 0.10007 |
| Swap: sibling fine-tune (Qwen2.5-Coder-0.5B) | 0.23087 | 0.75709 |
| Swap: different model (SmolLM2-360M) | 0.22339 | 0.74083 |

The smallest substitution is more than 100× further from the reference than honest noise. These runs were on CPU. Calibration across GPU types on Nosana is the next experiment (see `experiments/fingerprint/RESULTS.md`).

Reproduce:

```bash
python -m venv .venv && .venv/bin/pip install llama-cpp-python numpy
# download the GGUFs listed in experiments/fingerprint/README.md into ./models
.venv/bin/python experiments/fingerprint/run_experiment.py --models-dir ./models
```

## Use it

```bash
npm install && npm run build
alias ark="node packages/cli/dist/index.js"

ark wallet new --out wallet.json                      # Arweave wallet (free uploads < 105 KiB)
ark init qwen2.5-0.5b-instruct-q8_0.gguf \
  --name qwen2.5-0.5b-instruct-q8_0 --license apache-2.0 --publisher Qwen \
  --mirror https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q8_0.gguf \
  --vram 2
ark fingerprint manifest.json --endpoint http://localhost:8080 --hardware "reference"
ark publish manifest.json --fingerprint fingerprint.json --wallet wallet.json
ark quote qwen2.5-0.5b-instruct-q8_0.gguf             # live price to preserve the weights too
ark preserve manifest.json model.gguf --wallet wallet.json --yes

export NOSANA_API_KEY=...                             # from the Nosana dashboard; uses your credits
ark boot <manifest-id>                                # prints the endpoint once healthy
ark verify <manifest-id> --endpoint <url> --attest --wallet wallet.json
ark list
```

Web gallery: `cd web && cp .env.example .env.local && npm run dev`.

## Design

| Piece | File | Notes |
|---|---|---|
| Manifest (`ark/0.1`) | `packages/core/src/manifest.ts` | Canonical JSON, SHA-256, licence gate: only redistributable licences can be *preserved*, because Arweave can't delete. |
| Fingerprint (`ark-greedy/1`) | `packages/core/src/fingerprint.ts` | Greedy tokens + logprobs over the OpenAI API; random canary order; commit-reveal for private canaries. |
| Arweave | `packages/core/src/arweave.ts` | ar.io Turbo uploads, chunked weights, GraphQL discovery by tags (`App-Name: Ark`). |
| Nosana | `packages/core/src/nosana.ts` | Generated boot script with no custom image; exits 42 on any hash mismatch; HTTP health check. |
| Ledger | `packages/core/src/attestation.ts` | `ark-attestation/0.1` records, tagged by manifest, node and verdict. |
| CLI | `packages/cli` | Everything above from the terminal. |
| Web | `web/` | Next.js gallery, Boot, chat and *Verify this GPU*. |

**Tiers.** *Anchored*: the manifest and fingerprint are on Arweave, and the weights come from hash-checked mirrors. This uses the free tier. *Preserved*: the weights are on Arweave as well, which costs about $46/GiB at today's Turbo price.

## Limits

This is statistical evidence, not a cryptographic proof. A node that can recognise canaries could answer them honestly and cheat on everything else. Private canaries (anyone can fingerprint the permanent public weights on their own hardware), random order and decoy traffic make that harder. Hardware attestation (Nosana's confidential-compute markets) and activation proofs ([TOPLOC](https://arxiv.org/abs/2501.16007)) are stronger, and Ark is designed to sit next to them. Related work on API model-substitution audits: [Cai et al. 2025](https://arxiv.org/abs/2504.04715), [Gao et al., ICLR 2025](https://arxiv.org/abs/2410.20247).

## Tests

```bash
npm test        # 15 tests, including a real boot run against a local gateway (tamper → exit 42)
```

Apache-2.0.
