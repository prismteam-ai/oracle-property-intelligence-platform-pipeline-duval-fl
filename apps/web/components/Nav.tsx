"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearToken } from "../lib/config";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/records", label: "Records by source" },
  { href: "/workflows", label: "Inquiry workflows" },
  { href: "/explore", label: "Explore parcel" },
  { href: "/agent", label: "Ask the agent" },
  { href: "/publication", label: "IPFS / DuckDB / MCP" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <div className="nav-inner container">
        <span className="brand">
          Oracle<span className="brand-dim"> · Duval</span>
        </span>
        <div className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </div>
        <button className="ghost" onClick={() => { clearToken(); location.reload(); }}>Sign out</button>
      </div>
    </nav>
  );
}
