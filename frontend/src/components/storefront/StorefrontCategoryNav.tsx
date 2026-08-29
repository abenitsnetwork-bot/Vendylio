'use client';

import type { StorefrontSection } from '@/lib/storefrontGrouping';
import { sectionTitle } from '@/lib/storefrontGrouping';

/**
 * Sticky pill row for jumping between category sections on the storefront.
 * Anchor-scrolls to `#<section.anchor>` — the templates render each section
 * with a matching `id`. Hidden when there's only one section (nothing to
 * navigate).
 */
export function StorefrontCategoryNav({ sections }: { sections: StorefrontSection[] }) {
  if (sections.length < 2) return null;

  return (
    <nav
      aria-label="Product categories"
      className="sticky top-0 z-20 -mx-4 mb-6 overflow-x-auto border-b border-border bg-background/95 px-4 py-3 backdrop-blur lg:-mx-14 lg:px-14"
    >
      <ul className="flex gap-2 whitespace-nowrap">
        {sections.map((section) => (
          <li key={section.anchor}>
            <a
              href={`#${section.anchor}`}
              className="inline-block rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
            >
              {sectionTitle(section)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
