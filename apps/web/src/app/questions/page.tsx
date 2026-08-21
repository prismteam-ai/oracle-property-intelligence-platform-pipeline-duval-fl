import Link from "next/link";
import { QUESTIONS } from "@/lib/questions";

export const dynamic = "force-dynamic";

export default function QuestionsIndex() {
  return (
    <>
      <h1>Property intelligence questions</h1>
      <p className="muted" style={{ maxWidth: "70ch", marginTop: 8 }}>
        Each question runs live SQL against the published dataset on IPFS and
        shows the query, the evidence its answer rests on, and the limits of
        that evidence.
      </p>

      <div className="grid" style={{ marginTop: 24 }}>
        {QUESTIONS.map((q) => (
          <Link
            key={q.slug}
            href={`/questions/${q.slug}`}
            className="card"
            data-testid={`question-${q.slug}`}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <h2>{q.title}</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              {q.prompt}
            </p>
            <p className="subtle" style={{ marginTop: 10 }}>
              <strong>Derived from:</strong> {q.basis.slice(0, 150)}…
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
