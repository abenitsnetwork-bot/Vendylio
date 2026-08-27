export const STORE_TEMPLATES = [
  {
    value: 'MODERN',
    label: 'Modern',
    description: 'Clean product grid with category tags — works for most catalogs.',
  },
  {
    value: 'MINIMAL',
    label: 'Minimal',
    description: 'Single-column list, lots of whitespace — good for a small, curated catalog.',
  },
  {
    value: 'BOLD',
    label: 'Bold',
    description: 'Large imagery and big pricing — makes a strong first impression.',
  },
] as const;

export type StoreTemplate = (typeof STORE_TEMPLATES)[number]['value'];

export const STORE_TEMPLATE_VALUES = STORE_TEMPLATES.map((t) => t.value) as [
  StoreTemplate,
  ...StoreTemplate[],
];

export function isStoreTemplate(value: string): value is StoreTemplate {
  return (STORE_TEMPLATE_VALUES as readonly string[]).includes(value);
}
