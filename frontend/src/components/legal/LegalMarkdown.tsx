import { Fragment } from 'react';
import { parseLegalMarkdown, type LegalBlock, type Span } from '@/lib/legal/parseLegalMarkdown';

// Renders the legal-page Markdown subset (parseLegalMarkdown.ts) as React
// elements. Every string is a plain text child — React escapes it — so
// admin-authored content can't inject markup. No `dangerouslySetInnerHTML`.
//
// Styling comes from the parent wrapper (LegalPageLayout / the Terms modal
// both define `[&_h2]…`, `[&_p]…`, `[&_ul]…`, `[&_a]…` utilities), so this
// component emits bare semantic tags.
//
// Server and client safe (no hooks, no `'use client'`).

function renderSpans(spans: Span[]) {
  return spans.map((span, i) => {
    if ('href' in span) {
      const external = /^https?:\/\//i.test(span.href);
      return (
        <a
          key={i}
          href={span.href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {span.text}
        </a>
      );
    }
    if ('bold' in span) return <strong key={i}>{span.text}</strong>;
    if ('italic' in span) return <em key={i}>{span.text}</em>;
    return <Fragment key={i}>{span.text}</Fragment>;
  });
}

function renderBlock(block: LegalBlock, i: number) {
  switch (block.type) {
    case 'h2':
      return <h2 key={i}>{block.text}</h2>;
    case 'p':
      return <p key={i}>{renderSpans(block.spans)}</p>;
    case 'ul':
      return (
        <ul key={i}>
          {block.items.map((item, j) => (
            <li key={j}>{renderSpans(item)}</li>
          ))}
        </ul>
      );
  }
}

export function LegalMarkdown({ source, blocks }: { source?: string; blocks?: LegalBlock[] }) {
  const parsed = blocks ?? parseLegalMarkdown(source ?? '');
  return <>{parsed.map(renderBlock)}</>;
}
