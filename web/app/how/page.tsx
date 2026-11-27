export default function How() {
  return (
    <div style={{ paddingTop: 32, maxWidth: 760 }}>
      <h1>How Ark works</h1>

      <section className="block">
        <h2>The two problems</h2>
        <p>
          <b>Models disappear.</b> Microsoft pulled WizardLM-2 within about a day of release in April 2024. Runway removed its Stable
          Diffusion 1.5 repository in August 2024. Projects that depended on them broke, and people were left with copies they couldn&apos;t verify.
        </p>
        <p>
          <b>Decentralized GPUs ask you to trust strangers.</b> When you rent a GPU from someone you don&apos;t know, a hash on Arweave tells you
          which file <i>should</i> be running. It doesn&apos;t tell you which file <i>is</i> running. A node can quietly serve a cheaper quantization
          and you would never notice.
        </p>
      </section>

      <section className="block">
        <h2>Archive</h2>
        <p>
          A manifest records the model&apos;s files with their SHA-256 hashes, its licence, where it came from, and the exact runtime image and
          settings. <b>Anchored</b> models store the manifest and fingerprint on Arweave and fetch the weights from mirrors, which are always
          hash-checked. <b>Preserved</b> models also store the weights on Arweave, split into chunks, so they outlive every mirror. Ark only
          preserves models whose licences allow redistribution, because Arweave data can&apos;t be deleted.
        </p>
      </section>

      <section className="block">
        <h2>Boot</h2>
        <p>
          The Nosana job uses the unmodified llama.cpp server image. A generated script downloads each chunk, checks every hash, and starts
          the server only if all of them match. The whole procedure is readable in the job definition; there is no hidden container.
        </p>
      </section>

      <section className="block">
        <h2>Verify</h2>
        <p>
          A fingerprint is how the model behaves on a set of canary prompts with greedy decoding: which token it picks at each step, and how
          confident it is. Ark sends canaries in random order and compares. In our experiments an honest node matched to within 0.0002 in
          log-probability. Substituted models were 100 to 1,000 times further off: fp16 instead of q8_0, q6_k, q4_k_m, a sibling fine-tune,
          and a different model all failed. The full numbers are in the repository&apos;s experiments folder.
        </p>
        <p>
          Because the weights are public and permanent, anyone can make a <i>private</i> fingerprint on their own hardware. A node
          can&apos;t recognise canaries it has never seen.
        </p>
      </section>

      <section className="block">
        <h2>Limits, stated plainly</h2>
        <p>
          This is statistical evidence, not a cryptographic proof. A node that recognises the canaries could answer them honestly and cheat
          on everything else. Random order, private canaries and decoy traffic make that harder, but hardware attestation (confidential
          computing) or activation proofs like TOPLOC are stronger. Ark is designed to sit alongside them. Different GPU types add numerical
          noise, so the thresholds are calibrated on real Nosana hardware.
        </p>
      </section>
    </div>
  );
}
