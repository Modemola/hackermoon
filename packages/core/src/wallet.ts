import { generateKeyPairSync, createHash } from "node:crypto";
import type { JWK } from "./arweave.js";

/** Generate a new Arweave wallet (RSA-4096 JWK) with Node's crypto, no extra dependencies. */
export function generateWallet(): JWK {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096, publicExponent: 65537 });
  const jwk = privateKey.export({ format: "jwk" }) as Record<string, string>;
  return { kty: "RSA", e: jwk.e, n: jwk.n, d: jwk.d, p: jwk.p, q: jwk.q, dp: jwk.dp, dq: jwk.dq, qi: jwk.qi };
}

/** Arweave address = base64url(sha256(modulus bytes)). */
export function walletAddress(jwk: JWK): string {
  return createHash("sha256").update(Buffer.from(jwk.n, "base64url")).digest("base64url");
}
