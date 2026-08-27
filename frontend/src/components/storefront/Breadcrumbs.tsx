import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** Store / Category / Product — the real hierarchy Vendylio actually has
 * (a flat product `category`, not a nested taxonomy), so this never
 * fabricates subcategory levels a reference design might show. */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mx-auto max-w-6xl px-4 pt-6 text-xs text-muted-foreground lg:px-14"
    >
      {items.map((item, i) => (
        <span key={i}>
          {item.href ? (
            <Link href={item.href} className="hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
          {i < items.length - 1 && <span className="mx-2">/</span>}
        </span>
      ))}
    </nav>
  );
}
