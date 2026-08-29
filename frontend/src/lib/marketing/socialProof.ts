// Social-proof seller count shown on the landing + register pages.
//
// The number is real — a live count of published stores (see
// getPublishedSellerCount in lib/server/landing.ts). We only surface it once
// there are enough sellers for it to read as proof rather than as "we just
// launched", and we round DOWN to a conservative round figure so the claim is
// never an overstatement.

export const MIN_SELLERS_FOR_PROOF = 15;

/** Round a real count DOWN to a conservative round figure. */
export function roundedSellerCount(count: number): number {
  if (count < 100) return Math.floor(count / 10) * 10;
  if (count < 1000) return Math.floor(count / 50) * 50;
  return Math.floor(count / 100) * 100;
}

export interface SellerProof {
  /** Whether to render a numeric social-proof element at all. */
  show: boolean;
  /** e.g. "1,200+" — only meaningful when `show` is true. */
  label: string;
}

export function sellerProof(count: number): SellerProof {
  if (!Number.isFinite(count) || count < MIN_SELLERS_FOR_PROOF) {
    return { show: false, label: '' };
  }
  return { show: true, label: `${roundedSellerCount(count).toLocaleString('en-US')}+` };
}
