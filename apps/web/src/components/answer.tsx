import type { ReactNode } from "react";

/**
 * Render the agent's answer.
 *
 * The model replies in Markdown, and the page used to print it verbatim inside
 * `white-space: pre-wrap` — so the headline figure arrived wrapped in visible
 * asterisks, the caveats were a run of literal hyphens, and column names were
 * fenced in backticks. On the page the whole product is judged by, that reads
 * as a debug dump.
 *
 * This is deliberately not a Markdown library. The agent emits four things —
 * paragraphs, bold, inline code, and hyphen bullets — and a hundred lines here
 * is a better trade than a dependency and a sanitiser. Anything it does not
 * recognise falls through as plain text, which is the safe direction.
 */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Bold and inline code, in one pass so neither can swallow the other.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(
        <code key={key++} className="mono">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Answer({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${key++}`} className="answer-list">
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flushBullets();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet?.[1]) {
      bullets.push(bullet[1]);
      continue;
    }
    flushBullets();
    blocks.push(<p key={`p-${key++}`}>{inline(trimmed)}</p>);
  }
  flushBullets();

  return (
    <div className="answer" data-testid="agent-answer-text">
      {blocks}
    </div>
  );
}
