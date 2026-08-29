import { Icon } from '@/components/ui/Icon';
import { StarRating } from '@/components/ui/StarRating';

export interface SellerReview {
  id: string;
  orderId: string;
  rating: number;
  text: string | null;
  visible: boolean;
  createdAt: string;
  order: { customerName: string | null };
}

export function ReviewsTable({
  reviews,
  onToggleVisible,
}: {
  reviews: SellerReview[];
  onToggleVisible: (review: SellerReview) => void;
}) {
  if (reviews.length === 0) {
    return (
      <div className="py-16 text-center">
        <Icon i="star" size={32} className="mx-auto mb-4 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">
          No reviews yet. They show up here once a delivered order is reviewed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <div
          key={review.id}
          className={`rounded-lg border p-4 ${
            review.visible ? 'border-border bg-card' : 'border-border bg-secondary opacity-70'
          }`}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <StarRating rating={review.rating} size={14} />
              <span className="text-xs font-medium text-foreground">
                {review.order.customerName ?? 'Guest'}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(review.createdAt).toLocaleDateString()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onToggleVisible(review)}
              className="whitespace-nowrap rounded-lg border border-border px-3 py-1 text-xs font-semibold text-foreground hover:bg-secondary"
            >
              {review.visible ? 'Hide from storefront' : 'Show on storefront'}
            </button>
          </div>
          {review.text && <p className="text-sm text-foreground">{review.text}</p>}
        </div>
      ))}
    </div>
  );
}
