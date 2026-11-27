<!--
DRAFT for HackerNoon. Tags: decentralize-ai-hackathon, decentralize-ai, arweave, nosana, ai-inference, gpu-cloud, open-source, llms
Fill every [[TODO]] with real numbers from the Nosana GPU run and the real Arweave tx ids before publishing.
Cover image idea: a terminal showing VERIFIED (green) next to MISMATCH (red) for the same prompt.
-->

# A Stranger's GPU Said It Was Running My Model. I Made It Prove It.

*Ark: a permanent archive of open AI models on Arweave that boots on Nosana and checks, from the answers alone, which weights the GPU is really running.*

## The model that vanished in a day

In April 2024, Microsoft released WizardLM-2. About a day later it deleted the model, saying it had "accidentally missed an item required in the model release process — toxicity testing." Hugging Face's CEO said the takedown broke a number of open-source projects. The models had been downloaded more than 100,000 times a month. Copies survived on mirrors, but nobody could prove a mirror held the real thing.

That wasn't a one-off. Runway removed its Stable Diffusion 1.5 repository in August 2024, and the community carried on from mirrors. Several entries in this hackathon have already made the case for permanent model storage. ModelSeal and ModelProof hash model files and anchor the hashes on Arweave, and OpenWeightHub proposes a full weight registry.

Then I read a line in another entry, *Immutable Architecture*, that stopped me:

> "A hash on Arweave says nothing about which weights that server loaded, or whether it quietly swapped in a cheaper quantization. Proving that needs hardware attestation or verifiable inference, and neither is mature at large-model scale."

That is exactly the gap. Decentralized compute means renting a GPU from someone you don't know. A hash tells you which file *should* be running, not which file *is*. So I built the missing piece.

## What Ark does

```
archive ──▶ Arweave: manifest + SHA-256 + licence + runtime + behavioral fingerprint (permanent)
boot    ──▶ Nosana: stock llama.cpp image; fetch, hash-check every file, then serve
verify  ──▶ hidden canary prompts → compare tokens + log-probabilities → VERIFIED / MISMATCH
attest  ──▶ the verdict goes back to Arweave: a permanent public ledger of honest GPUs
```

[[TODO: 20-second GIF: gallery → Boot → chat → "Verify this GPU" → ✓ Verified genuine]]

## Part 1: Archive

Every model gets an `ark/0.1` manifest: file names, sizes and SHA-256 hashes, licence, origin, and the exact runtime image and arguments. There are two tiers:

- **Anchored.** The manifest and fingerprint go on Arweave. Both fit in Turbo's free tier (data items up to ~105 KiB), and the weights are pulled from mirrors, always hash-checked.
- **Preserved.** The weights themselves also go on Arweave, in 256 MB chunks. At today's Turbo quote that costs about **$46 per GiB**. That's affordable for small models like the 0.5–3B class, and it's the honest reason not to put a 70B model on-chain.

Arweave is permanent, which cuts both ways. Ark refuses to *preserve* a model unless its licence clearly allows redistribution (Apache-2.0, MIT and similar), because nothing can be taken down later.

## Part 2: Boot, with no hidden container

Ark doesn't ship a custom Docker image. The Nosana job runs the official `ghcr.io/ggml-org/llama.cpp:server-cuda` image with a generated script you can read in full:

```sh
fetch 'https://arweave.net/<chunk-0>' part.0
check <sha256-of-chunk-0> part.0
...
check <sha256-of-file> qwen2.5-0.5b-instruct-q8_0.gguf   # exit 42 on any mismatch
exec /app/llama-server -m qwen2.5-0.5b-instruct-q8_0.gguf ...
```

The test suite runs this exact script against a local gateway. Correct chunks are reassembled and served, and a single flipped bit stops the boot with exit code 42. In a simulated node run it pulled a 675 MB model, verified it and came up healthy in 12 seconds. On real Nosana hardware: [[TODO: time-to-healthy per GPU]].

## Part 3: Verify. This is the part nobody else had.

A **behavioral fingerprint** records what a model does on a set of canary prompts with greedy decoding: which token it picks at each step, and how confident it is (the log-probability). OpenAI-compatible servers such as llama.cpp, vLLM and Ollama already return these values, so verification needs no cooperation from the node.

Different weights shift those numbers. The question is whether they shift them *more* than the noise an honest machine produces. So I measured it. The reference was Qwen2.5-0.5B-Instruct q8_0, with 24 canaries of 32 tokens each:

| What the node is really serving | Canaries identical | Mean \|Δ logprob\| |
|---|---|---|
| The real file (4 / 2 / 1 threads, batch 512 / 64 / 8) | 24/24 | 0.00000 – 0.00019 |
| fp16: a *more precise* copy of the same model | 19/24 | 0.025 |
| q6_k quantization | 14/24 | 0.026 |
| q4_k_m quantization | 8/24 | 0.076 |
| Sibling fine-tune (Qwen2.5-Coder-0.5B) | 0/24 | 0.231 |
| A different model (SmolLM2-360M) | 0/24 | 0.223 |

Two things surprised me.

First, **honest noise was effectively zero.** Changing thread count and batch size reorders floating-point maths, yet every greedy token was identical, and the log-probabilities moved by at most 0.0002.

Second, **comparing text alone misses swaps.** The fp16 copy produced word-for-word identical answers on 19 of 24 prompts. Its log-probabilities still gave it away, at about 130× the honest noise. That's why Ark compares confidence values and not just output text.

Then I ran the real tool against real servers:

| Target | Verdict |
|---|---|
| Genuine q8_0 `llama-server` | ✅ VERIFIED: 12/12 identical, Δ = 0 |
| q4_k_m impostor on the same port | ❌ MISMATCH: 4/12 identical, Δ = 0.066 |
| Simulated Nosana node (generated boot script) | ✅ VERIFIED: 12/12 identical |
| [[TODO: real Nosana nodes, 5 GPU types]] | [[TODO]] |

Everything is reproducible. The experiment lists every model file by SHA-256 and runs with one command.

### Prior work this builds on

Auditing model substitution is an active research area. Cai et al. ("Are You Getting What You Pay For?", 2025) tested statistical and logprob-based checks against quantization and substitution attacks in commercial LLM APIs. Gao, Liang and Guestrin framed it as *model equality testing* (ICLR 2025). Prime Intellect's **TOPLOC** (Ong et al., ICML 2025) commits to hashes of intermediate activations, so a verifier can detect changes to the model, prompt or precision. Ark's contribution isn't a new detector. It is the first system, as far as I can find, that combines a **permanent archive** with **one-click decentralized boot** and **behavioral verification of the node you just rented**, and records each verdict permanently.

## Part 4: A public ledger of GPUs that told the truth

Each verification can be written to Arweave as an `ark-attestation/0.1` record, tagged by model, market and verdict. Over time that becomes something decentralized compute doesn't have yet: a reputation history that no operator can edit.

[[TODO: link to the first real attestation tx]]

## What it can't do (yet)

- **It's evidence, not proof.** A node that *recognises* canaries could answer them honestly and cheat on everything else. Ark sends canaries in random order and supports **private canaries**: because the weights are public and permanent, anyone can fingerprint them on their own hardware, with a hash commitment published first. A node can't special-case prompts it has never seen. Hardware attestation (Nosana's confidential-compute markets) and activation proofs like TOPLOC are stronger. Ark is designed to work alongside them, not replace them.
- **GPUs are noisier than CPUs.** Different CUDA kernels and batched concurrent requests move logprobs more than CPU threading does. The thresholds above are provisional until the cross-GPU run on Nosana: [[TODO: results; per-hardware-class fingerprints if needed]].
- **Big models are expensive to preserve.** At ~$46/GiB, Ark *anchors* large models and *preserves* the ones most at risk.

## Try it

```bash
git clone https://github.com/modemola/hackermoon && cd hackermoon
npm install && npm run build && npm test
node packages/cli/dist/index.js verify <manifest-id> --endpoint <any-openai-compatible-url>
```

Live gallery: [[TODO: URL]] · Code (Apache-2.0): https://github.com/modemola/hackermoon

*Built for the Decentralize AI Hackathon by HackerNoon, Nosana, Arweave and MEXC. Next post: what I learned running the same model on [[N]] different Nosana GPUs for under a dollar.*
