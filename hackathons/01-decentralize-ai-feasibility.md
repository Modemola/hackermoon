# Feasibility Study: Decentralize AI Hackathon, Round 2

> **Update, 27 Nov 2026 (later the same day): confirmed findings. These replace the estimates below where they differ.**
>
> **Rules, from decentralizeai.tech:**
> - You can enter as many times as you like, in either round.
> - Judges shortlist entries by readership and quality, then vote.
> - Projects are judged on technical depth, originality, impact, and verifiable evidence (code, a URL, or metrics). Mockups are not eligible.
> - The judging rubric rewards citing specific projects, papers and people.
> - Judges include Sjoerd Dijkstra (Nosana co-founder) and Valeria Kholostenko (Decentralized Storage Alliance).
>
> **Competition:** the `#decentralize-ai-hackathon` tag has 57 stories. Weight registries and receipts are crowded: ModelSeal, ModelProof ×2, OpenWeightHub, Bothy, Proof-of-Assay, VeriTrace and SealedBench. The *Immutable Architecture* entry explicitly calls verifying remote inference unsolved. Ark targets exactly that.
>
> **Live prices:**
> - Nosana RTX 3060 costs $0.04/h and RTX 4090 $0.36/h, so a cross-GPU test is under $1.
> - Arweave via Turbo costs **$46/GiB**, much higher than the earlier $3–8 estimate. Turbo's free tier covers items up to 105 KiB, so manifests and fingerprints (~11 KB) are free, and weights are preserved selectively.
>
> **Risk spike 2 (fingerprint separation): PASSED on CPU.** Honest Δ ≤ 0.0002; the closest swap (fp16) shows Δ 0.025, about 130× higher. See `experiments/fingerprint/RESULTS.md`.
>
> **Risk spike 1 (boot from storage):** the generated boot script was tested for real. It fetched 675 MB, checked SHA-256, and was healthy in 12 s. It has not yet been run on a Nosana node; that needs an API key.
>
> **Built:** `@ark/core`, the CLI, the Next.js gallery, 15 passing tests, and a draft post (`docs/hackernoon-post-draft.md`).

Date: 27 Nov 2026. Deadline: 27 Feb 2027 (about 13 weeks left).
Method: web research on the rules, the sponsors' technology, and entries competitors have already published. I could not open decentralizeai.tech or hackernoon.com directly because this session's network blocks them. Facts below come from search results and need a manual check (see Open questions).

---

## 1. What actually wins this contest

| Signal | What it means for us |
|---|---|
| You enter by publishing a HackerNoon post tagged `#decentralize-ai` | The post is the product judges see first. A great build with a dull post loses. |
| Readership and post quality are judged | We need a headline people want to click, plus our own promotion. |
| Technical depth, originality, proof it works | A live demo and a public repo, plus an honest section on limitations. |
| Prizes from both Nosana and Arweave | Use both, and use them for real rather than as a token gesture. |
| Grand prize is a Next.js publishing site | Building in Next.js shows we could run the prize. |

## 2. Competitor scan: ideas that are already taken

Entries and tools I found that already exist:

| Idea | Already done by | Verdict |
|---|---|---|
| AI output receipts or provenance on Arweave | Bothy, VeriTrace, ModelProof (2 posts), CHP Locknet, and **ar.io's own official MLflow plugin** | **Crowded. Avoid.** (This rules out my earlier "inference receipts" idea.) |
| Model weight hashing and manifests on Arweave | ModelProof | Taken. It stores and hashes models but cannot run them. |
| Routing LLM inference to Nosana or OpenAI-style gateways | OpenInfer, "AI Agent Orchestrator" | Crowded |
| A local agent that rents a Nosana GPU | "My Local AI Agent Needed a Bigger Brain" | Taken |
| Vertical pipelines (e.g. game textures on Nosana + Arweave) | AI Texture Pipeline | Taken, and the category gets copied easily |

**Gap I found:** nobody makes stored models **runnable again**, and nobody **proves that a stranger's GPU is running the exact model you asked for**. ModelProof's author lists linking weights to outputs as future work.

## 3. Candidate ideas, scored

Scores are 1 to 5.

| # | Idea | Unique | Demo "wow" | Marketable | Uses Nosana + Arweave | Feasible in 8 weeks solo | Total |
|---|---|---|---|---|---|---|---|
| **A** | **Ark: a permanent archive of AI models that anyone can boot again on decentralized GPUs, with proof each one is genuine** | 5 | 5 | 5 | 5 | 4 | **24** |
| B | Node honesty auditor: secretly test Nosana nodes for model swaps and keep a public reputation log on Arweave | 5 | 3 | 3 | 5 | 4 | 20 |
| C | Inference receipts (my earlier idea) | 1 | 3 | 3 | 4 | 5 | 16 |
| D | OpenAI-compatible router to Nosana | 1 | 2 | 3 | 3 | 5 | 14 |

**Recommendation: A, with B built in as its verification engine.** Together they solve both of the questions judges will ask: *"why permanent storage?"* and *"why trust decentralized compute?"*

---

## 4. The idea: **Ark** (working name)

> **"A Wayback Machine for AI models.** Pick a model, even one its creator deleted. It boots on a stranger's GPU in about two minutes and *proves* it is the real thing."

### The problem (real and current)
- **Models disappear.** Microsoft pulled WizardLM-2 within about a day of release in April 2024. Hugging Face's CEO said this broke open-source projects; the models were downloaded more than 100k times a month. Copies survived only on scattered community mirrors with no proof they were authentic.
- Gated repos, licence changes, deleted accounts, and API model retirements break research reproducibility and pinned production systems.
- **Decentralized GPUs have a trust problem.** When you rent a GPU from someone you don't know, how do you know they didn't swap in a cheaper, quantized, or different model?

### How it works
1. **Archive.** A CLI packages an open-licence model: the weights (GGUF), the tokenizer, the exact runtime container digest, the chat template, the model card and the licence. It uploads everything to Arweave through Turbo. The result is one permanent **Ark manifest** with a transaction ID.
2. **Fingerprint.** We run the model once on a reference GPU and record a **behavioral fingerprint**: the top-k next-token logprobs on a set of hidden "canary" prompts. The public fingerprint gets a hash commitment on Arweave, and the canary prompts stay hidden until they are used.
3. **Resurrect.** A one-click "Boot" posts a Nosana job. The container pulls the weights straight from an Arweave gateway, checks the SHA-256 hashes, and serves an OpenAI-compatible endpoint (llama.cpp server).
4. **Verify.** The client mixes canary prompts into normal traffic and compares the logprobs against the fingerprint, allowing for small numerical differences between GPUs. The result is shown as a badge: ✅ *Verified genuine* / ❌ *Mismatch: possible substitution*.
5. **Ledger (idea B).** Each verification result is appended to Arweave. Over time this becomes a public, permanent reputation log of Nosana nodes.
6. **Gallery.** A Next.js "museum" of archived models, each with a Boot button, a chat window and its verification history.

### Why judges and sponsors should like it
- **It needs both sponsors.** Neither half works without the other: Arweave makes the model permanent, and Nosana makes it runnable. Both sponsors get a flagship showcase, so they are more likely to share the post, which helps readership.
- **It is original.** It does not overlap with the receipt, router or agent entries above. It goes beyond ModelProof, which stores models but cannot run or verify them.
- **It has technical depth.** It deals with numerical noise across different GPUs, an honest threat model for verification, and archives of several GB built from chunks with manifests. TOPLOC (Prime Intellect, ICML 2025) is a stretch goal for checking activations.
- **The headline is strong.** For example: *"Microsoft Deleted This AI Model in 24 Hours. I Made It Immortal, and It Runs on a Stranger's GPU."*

### Who would use it, and could it become a product
- Researchers who need to reproduce a paper's exact model years later.
- Teams that want a pinned, auditable model version they control.
- Archivists, journalists and "sovereign AI" communities.
- Nosana renters who want proof their node is honest.
- Possible business: paid "archive and certify" service for model publishers, a hosted verification API, and fees on boots.

---

## 5. Technical feasibility

| Component | Evidence | Risk | Mitigation |
|---|---|---|---|
| Storing weights on Arweave | One-time fee of roughly $3–8/GB (estimates vary with the AR price). A 1–4 GB GGUF costs about $3–30 per model. | Low | Start with small models (Qwen 2.5 0.5B–3B, Llama-3.2-1B/3B, WizardLM-2-7B Q4). Get a live Turbo quote first. |
| Uploading large files | The ArDrive browser cap is 2 GiB, but there is no protocol limit; SDK and CLI uploads are fine. | Low | Use the Turbo SDK, split files into chunks of about 1 GB, and stitch them with a manifest. |
| Nosana jobs | JSON job definitions (container image + commands), with a REST API, the `@nosana/kit` SDK and a CLI. An Ollama endpoint example already exists. | Low | Start from the official Ollama or llama.cpp example. |
| Pulling weights from Arweave inside a Nosana job | Not confirmed yet | **Medium** | **Spike in week 1.** Measure download time from an ar.io gateway. Fallback: a container image with the weights baked in, with its digest anchored on Arweave. |
| Cost of compute | RTX 4090 about $0.40/hr, so the $70 credits buy about 175 GPU-hours | Low | Enough for development and the demo. Public demo boots are rate-limited. |
| Behavioral fingerprint across GPUs | Floating-point results differ slightly between GPUs. TOPLOC reports robustness across GPUs and detects precision changes. | **Medium-High** (the core research risk) | **Spike in weeks 1–2:** same model on 3 Nosana GPU types vs a Q4/Q8 swap vs a different model. Measure the separation. If logprobs are too noisy, use top-1 token agreement over many tokens, or TOPLOC with vLLM. |
| Attack: node answers canaries honestly but cheats otherwise | Known limitation | Medium | Canaries look like normal traffic and are sampled randomly. State the limit honestly in the post as a threat model. |
| Licences | — | Medium | Archive only Apache, MIT or other licences that allow redistribution. Store the licence in the manifest. Arweave data cannot be deleted, so never upload restricted weights. |

**Overall: FEASIBLE solo in 6–8 weeks.** There are two unknowns, and both get tested in the first 2 weeks before we commit.

## 6. Plan (working back from 27 Feb)

| Week | Dates | Deliverable |
|---|---|---|
| 0 | now | Claim $70 Nosana credits; set up Turbo/Arweave wallet; confirm rules (see Open questions) |
| 1–2 | Dec 1–14 | **Kill-or-commit spikes:** Arweave→Nosana weight pull; fingerprint separation experiment |
| 3–4 | Dec 15–28 | CLI: `ark archive`, `ark boot`, `ark verify`; manifest spec v0 |
| 5–6 | Dec 29–Jan 11 | Next.js gallery + Boot button + live chat + verify badge; ledger writes |
| 7 | Jan 12–18 | Archive 5–10 models including the WizardLM-2 story; polish; record demo video |
| 8 | **Jan 19–25** | **Publish main post** (early, so it has a month to collect reads) |
| 9–12 | Jan 26–Feb 22 | Post #2: "How I spent my $70 of Nosana credits" (counts for the $450 prizes); post #3: fingerprint research results; promote on X, Reddit (r/LocalLLaMA), Hacker News, and Nosana/Arweave Discords |

## 7. Readership plan (scored, so plan for it)
- The headline tells a story (the deleted model), not "I built a tool".
- Include a GIF in the first screen: Boot → chat → ✅ Verified.
- Tag the sponsors' X accounts and ask their developer-relations teams to share.
- Pitch r/LocalLLaMA with a "deleted models you can boot forever" angle, and a "Show HN" post.
- Write 3 posts instead of 1. Each one links to the others.

## 8. Open questions to confirm manually
1. Exact Round 2 judging: how much do reads count compared with judges' votes? Who are the judges?
2. Are multiple entries per person allowed? (A series of posts could then count several times.)
3. Do participants get Arweave credits up front, or only winners?
4. Who won Round 1, and what did they build? (This tells us what judges reward.)
5. Name check: "Ark" is generic, so choose a final name before publishing.

## Sources
- [Decentralize AI Hackathon (official)](https://decentralizeai.tech/), [FAQ](https://decentralizeai.tech/faq), [HackerNoon announcement](https://hackernoon.com/compete-for-over-$51k-in-the-decentralize-ai-hackathon-by-hackernoon-nosana-arweave-and-mexc), [Winner gets the website](https://hackernoon.com/decentralize-ai-tech-contest-winner-gets-the-website)
- Competitors: [Bothy](https://hackernoon.com/bothy-building-verifiable-ai-decisions-with-arweave-receipts), [ModelProof](https://hackernoon.com/modelproof-bit-exact-permanently-stored-ai-models-you-can-verify-in-a-browser-tab), [ar.io Verifiable AI](https://docs.ar.io/build/verifiable-ai/), [OpenInfer](https://github.com/Yash-kumar-coder/OpenInfer), [CHP Locknet](https://github.com/Cubiczan/chp-locknet), [AI Texture Pipeline](https://hackernoon.com/how-we-built-an-ai-texture-pipeline-for-3d-games-with-nosana-and-arweave), [Agent Orchestrator](https://hackernoon.com/building-an-ai-agent-orchestrator-for-decentralized-gpu-compute), [Local agent + Nosana](https://hackernoon.com/my-local-ai-agent-needed-a-bigger-brain-so-i-gave-it-a-decentralized-gpu)
- Tech: [Nosana job definition](https://learn.nosana.com/deployments/jobs/job-definition/intro.html), [Nosana endpoints](https://learn.nosana.com/inference/endpoints.html), [Nosana GPU pricing](https://nosana.com/blog/cloud-gpu-providers-compared), [Turbo credits](https://docs.ar.io/build/upload/turbo-credits/), [ArDrive limits](https://ardrive.io/help/faqs-help-and-troubleshooting-guides-ardrive-app-limits/), [TOPLOC paper](https://arxiv.org/abs/2501.16007)
- Problem evidence: [404 Media on WizardLM-2](https://www.404media.co/microsoft-deleted-its-llm-because-it-didnt-get-a-safety-test-but-now-its-everywhere/), [HF discussion](https://huggingface.co/mradermacher/WizardLM-2-8x22B-GGUF/discussions/2)
