import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Duval Oracle — Property Intelligence Pipeline",
  description:
    "Continuous, incremental ingestion of Duval County, FL public property data into a DuckDB warehouse published to Elephant IPFS and served over MCP.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/runs", label: "Pipeline runs" },
  { href: "/explore", label: "Explore" },
  { href: "/questions", label: "Questions" },
  { href: "/artifacts", label: "IPFS artifacts" },
  { href: "/agent", label: "Agent" },
  { href: "/infrastructure", label: "Infrastructure" },
  { href: "/demo", label: "Demo" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="shell masthead-inner">
            <Link href="/" className="brand" data-testid="brand">
              Duval Oracle <span>· Duval County, FL</span>
            </Link>
            <nav className="nav">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main>
          <div className="shell">{children}</div>
        </main>
      </body>
    </html>
  );
}
