// A deliberately tiny Markdown parser for the editable legal pages.
//
// It produces a plain data AST (no React, no HTML string) that
// components/legal/LegalMarkdown.tsx maps to React elements — so
// admin-authored text can NEVER inject markup: every string ends up as a
// React text child, which React escapes. There is no `dangerouslySetInnerHTML`
// anywhere in the legal rendering path.
//
// Supported subset (everything a legal page needs, nothing more):
//   ## Heading                 -> { type: 'h2' }
//   blank-line-separated text   -> { type: 'p' }
//   lines starting with "- "    -> { type: 'ul', items: [...] }
//   **bold**  *italic*  [label](href)
//
// Link hrefs are restricted to http(s), mailto, and root-relative ("/x")
// URLs. Anything else (e.g. `javascript:`) is emitted as literal text.

export type Span =
  | { text: string }
  | { text: string; bold: true }
  | { text: string; italic: true }
  | { text: string; href: string };

export type LegalBlock =
  | { type: 'h2'; text: string }
  | { type: 'p'; spans: Span[] }
  | { type: 'ul'; items: Span[][] };

const SAFE_HREF = /^(https?:\/\/|mailto:|\/)/i;

// Ordered alternatives: bold before italic so `**x**` isn't read as two `*x*`.
const INLINE = /(\*\*([^*]+?)\*\*)|(\*([^*\n]+?)\*)|(\[([^\]]+?)\]\(([^)\s]+?)\))/g;

export function parseInlineSpans(input: string): Span[] {
  const spans: Span[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: input.slice(lastIndex, match.index) });
    }

    const bold = match[2];
    const italic = match[4];
    const linkLabel = match[6];
    const linkHref = match[7];
    if (bold !== undefined) {
      spans.push({ text: bold, bold: true });
    } else if (italic !== undefined) {
      spans.push({ text: italic, italic: true });
    } else if (linkLabel !== undefined && linkHref !== undefined) {
      if (SAFE_HREF.test(linkHref)) {
        spans.push({ text: linkLabel, href: linkHref });
      } else {
        // Unsafe / unrecognised scheme — keep the raw markdown as plain text.
        spans.push({ text: match[0] });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    spans.push({ text: input.slice(lastIndex) });
  }

  // An empty input still yields one empty text span so callers can rely on
  // a non-empty array.
  return spans.length > 0 ? spans : [{ text: '' }];
}

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'p', spans: parseInlineSpans(paragraph.join(' ').trim()) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'ul', items: listItems.map((item) => parseInlineSpans(item)) });
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = /^##\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);

    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'h2', text: (heading[1] ?? '').trim() });
      continue;
    }
    if (bullet) {
      flushParagraph();
      listItems.push((bullet[1] ?? '').trim());
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    // Plain prose line — a list ends as soon as a non-bullet line appears.
    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}
