export const PRODUCT_CATEGORIES = [
  { value: 'FOOD_SPICES', label: 'Food & Spices' },
  { value: 'BEAUTY_PERSONAL_CARE', label: 'Beauty & Personal Care' },
  { value: 'TEXTILES_CRAFTS', label: 'Textiles & Crafts' },
  { value: 'OTHER', label: 'Other' },
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]['value'];

/** Tuple of category values — shaped for z.enum(). */
export const PRODUCT_CATEGORY_VALUES = PRODUCT_CATEGORIES.map((c) => c.value) as [
  ProductCategory,
  ...ProductCategory[],
];

const LABELS: Record<ProductCategory, string> = Object.fromEntries(
  PRODUCT_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<ProductCategory, string>;

export function productCategoryLabel(value: string): string {
  return LABELS[value as ProductCategory] ?? value;
}
