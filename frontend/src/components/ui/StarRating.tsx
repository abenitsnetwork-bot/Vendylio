import { Icon } from '@/components/ui/Icon';

/** Read-only star display — rounds to the nearest whole star. */
export function StarRating({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon
          key={n}
          i="star"
          size={size}
          className={
            n <= Math.round(rating) ? 'fill-current text-amber-400' : 'text-muted-foreground/30'
          }
        />
      ))}
    </div>
  );
}

/** Interactive 1-5 star picker for the review form. */
export function StarRatingInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (rating: number) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(n)}
          className="p-0.5"
        >
          <Icon
            i="star"
            size={28}
            className={n <= value ? 'fill-current text-amber-400' : 'text-muted-foreground/30'}
          />
        </button>
      ))}
    </div>
  );
}
