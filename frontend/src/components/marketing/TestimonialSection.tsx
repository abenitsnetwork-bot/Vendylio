import type { LandingTestimonial } from '@/lib/server/landing';

export function TestimonialSection({ testimonials }: { testimonials: LandingTestimonial[] }) {
  if (testimonials.length === 0) return null;

  return (
    <section
      id="testimonials"
      className="border-t border-border bg-background px-4 py-16 font-body lg:px-14 lg:py-20"
    >
      <div className="mx-auto mb-10 max-w-7xl text-center lg:mb-12">
        <h2
          className="mb-3 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(26px, 4vw, 36px)', letterSpacing: '-0.8px' }}
        >
          What our sellers say
        </h2>
        <p className="text-sm text-muted-foreground">
          Real stories from the African diaspora community
        </p>
      </div>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((item) => (
          <div
            key={item.id}
            className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6"
          >
            <p className="text-sm leading-relaxed text-foreground">&ldquo;{item.quote}&rdquo;</p>
            <div className="flex items-center gap-3">
              {item.avatarUrl ? (
                <img
                  src={item.avatarUrl}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {item.name.charAt(0)}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {item.name}
                  {item.location ? ` — ${item.location}` : ''}
                </p>
                {item.detail && <p className="text-xs text-muted-foreground">{item.detail}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
