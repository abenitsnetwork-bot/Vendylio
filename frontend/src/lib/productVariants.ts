// Phase 7 — simple independent variant options. A product has zero or more
// of these; a buyer picks at most ONE per cart line (no Size×Color
// combinatorial matrix — see the ProductVariant comment in schema.prisma).
export interface ProductVariantOption {
  id: string;
  name: string;
  value: string;
  priceDeltaCents: number;
  quantity: number;
}

/** "Size: Large" — shown in the picker and echoed back as the cart line's label. */
export function variantLabel(variant: ProductVariantOption): string {
  return `${variant.name}: ${variant.value}`;
}

/** Base product price plus the selected variant's delta (0 when none selected). */
export function effectivePriceCents(
  basePriceCents: number,
  variant: ProductVariantOption | null | undefined,
): number {
  return basePriceCents + (variant?.priceDeltaCents ?? 0);
}

/** Formatted absolute price of one option ("$15.00") — base + this option's
 *  delta. Shown under each choice in the storefront picker so a shopper sees
 *  what each option costs before selecting it. */
export function variantOptionPriceLabel(
  basePriceCents: number,
  variant: ProductVariantOption,
): string {
  return `$${(effectivePriceCents(basePriceCents, variant) / 100).toFixed(2)}`;
}

export interface ProductForVariantPicker {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  quantity: number;
  unit: string;
  variants: ProductVariantOption[];
}

/** Resolves the effective price/stock/variant info for whatever the buyer
 * currently has selected, in the shape CartContext's `addItem` expects.
 * Shared across the storefront templates so they don't triple this logic. */
export function toAddableProduct(
  product: ProductForVariantPicker,
  selectedVariantId: string | null,
) {
  const variant = product.variants.find((v) => v.id === selectedVariantId) ?? null;
  return {
    id: product.id,
    name: product.name,
    priceCents: effectivePriceCents(product.priceCents, variant),
    imageUrl: product.imageUrl,
    quantity: variant ? variant.quantity : product.quantity,
    unit: product.unit,
    ...(variant ? { variantId: variant.id, variantLabel: variantLabel(variant) } : {}),
  };
}
