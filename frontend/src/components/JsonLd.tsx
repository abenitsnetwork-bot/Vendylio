import { serializeJsonLd } from '@/lib/seo';

/**
 * Renders a Schema.org JSON-LD block. Server component — the object is
 * serialized (and HTML-escaped, see serializeJsonLd) on the server and
 * injected as text. This is the only place merchant-supplied text touches a
 * <script> tag; it is never rendered as HTML anywhere.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
