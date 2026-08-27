import type { PublicReview } from '@/lib/server/storefront';
import { StarRating } from '@/components/ui/StarRating';

/**
 * Shared visible-reviews section, used identically by all three storefront
 * templates (Modern/Minimal/Bold) — unlike the per-product variant picker,
 * this has no interactive state of its own, so a single component covers
 * all three rather than tripling the same markup.
 */
export function StoreReviews({
  reviews,
  averageRating,
  reviewCount,
}: {
  reviews: PublicReview[];
  averageRating: number | null;
  reviewCount: number;
}) {
  if (reviewCount === 0) return null;

  return (
    <section className="mt-14 border-t border-border pt-10">
      <div className="mb-6 flex items-center gap-3">
        <h2 className="font-headings text-xl font-bold text-foreground">Reviews</h2>
        {averageRating !== null && (
          <div className="flex items-center gap-2">
            <StarRating rating={averageRating} />
            <span className="text-sm text-muted-foreground">
              {averageRating.toFixed(1)} ({reviewCount} review{reviewCount === 1 ? '' : 's'})
            </span>
          </div>
        )}
      </div>
      <div className="space-y-4">
        {reviews.map((review) => (
          <div key={review.id} className="rounded-lg border border-border bg-card p-4">
            <div className="mb-1 flex items-center justify-between">
              <StarRating rating={review.rating} size={14} />
              <span className="text-xs text-muted-foreground">
                {review.customerName ?? 'Verified buyer'}
              </span>
            </div>
            {review.text && <p className="text-sm text-foreground">{review.text}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
