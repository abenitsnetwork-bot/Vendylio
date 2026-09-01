import { describe, it, expect } from 'vitest';
import { parseLegalMarkdown, parseInlineSpans } from './parseLegalMarkdown';

describe('parseInlineSpans', () => {
  it('splits bold, italic and plain runs', () => {
    expect(parseInlineSpans('a **b** c *d* e')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c ' },
      { text: 'd', italic: true },
      { text: ' e' },
    ]);
  });

  it('keeps safe link schemes (root-relative, mailto, https)', () => {
    expect(parseInlineSpans('see [Refund](/refund-policy)')).toEqual([
      { text: 'see ' },
      { text: 'Refund', href: '/refund-policy' },
    ]);
    expect(parseInlineSpans('[mail](mailto:no-reply@vendylio.com)')).toEqual([
      { text: 'mail', href: 'mailto:no-reply@vendylio.com' },
    ]);
    expect(parseInlineSpans('[site](https://vendylio.com)')).toEqual([
      { text: 'site', href: 'https://vendylio.com' },
    ]);
  });

  it('renders an unsafe href as literal text, never a link', () => {
    const spans = parseInlineSpans('[x](javascript:alert%201)');
    expect(spans).toEqual([{ text: '[x](javascript:alert%201)' }]);
    expect(spans.some((s) => 'href' in s)).toBe(false);
  });

  it('never emits an href for a data: URL', () => {
    const spans = parseInlineSpans('[y](data:text/html,<script>)');
    expect(spans.every((s) => !('href' in s))).toBe(true);
  });
});

describe('parseLegalMarkdown', () => {
  it('parses headings, paragraphs and bullet lists', () => {
    const blocks = parseLegalMarkdown(
      ['Intro line.', '', '## Section', '', '- one', '- two', '', 'Tail.'].join('\n'),
    );
    expect(blocks).toEqual([
      { type: 'p', spans: [{ text: 'Intro line.' }] },
      { type: 'h2', text: 'Section' },
      {
        type: 'ul',
        items: [[{ text: 'one' }], [{ text: 'two' }]],
      },
      { type: 'p', spans: [{ text: 'Tail.' }] },
    ]);
  });

  it('treats a raw <script> tag as ordinary text (no element, no markup)', () => {
    const blocks = parseLegalMarkdown('Hello <script>alert(1)</script> world');
    expect(blocks).toEqual([
      { type: 'p', spans: [{ text: 'Hello <script>alert(1)</script> world' }] },
    ]);
  });

  it('parses bold at the start of a list item', () => {
    const blocks = parseLegalMarkdown('- **Stripe** — card payments');
    expect(blocks).toEqual([
      {
        type: 'ul',
        items: [[{ text: 'Stripe', bold: true }, { text: ' — card payments' }]],
      },
    ]);
  });

  it('round-trips the bundled Terms default into blocks', async () => {
    const { LEGAL_DEFAULTS } = await import('./defaults');
    const blocks = parseLegalMarkdown(LEGAL_DEFAULTS.terms.body);
    expect(blocks.filter((b) => b.type === 'h2').length).toBe(11);
    expect(blocks[0]).toEqual({ type: 'p', spans: expect.any(Array) });
  });
});
