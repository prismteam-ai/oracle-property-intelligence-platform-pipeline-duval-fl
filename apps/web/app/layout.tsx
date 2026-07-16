import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "../components/Nav";

export const metadata: Metadata = {
  title: "Oracle Property Intelligence — Duval County",
  description: "Authenticated exploration of reconciled Duval County property records.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="container">{children}</main>
          <footer className="footer muted small">
            Oracle Property Intelligence Platform · Duval County, FL · reconciled records served from
            an authenticated hosted layer · owner PII is never sent to the client.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
