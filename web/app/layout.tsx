import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ark — AI models that can't disappear",
  description:
    "A permanent archive of open AI models on Arweave. Boot any of them on a decentralized GPU in one click, and prove the GPU is running the real thing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand">
              A<span>R</span>K
            </Link>
            <nav>
              <Link href="/">Archive</Link>
              <Link href="/how">How it works</Link>
              <a href="https://github.com/modemola/hackermoon">Code</a>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer>
          <div className="wrap">
            Weights and records on Arweave · compute on Nosana · open source (Apache-2.0). Built for the Decentralize AI Hackathon.
          </div>
        </footer>
      </body>
    </html>
  );
}
