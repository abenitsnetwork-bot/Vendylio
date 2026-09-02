import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';

const NEXT_STEPS = [
  { title: 'Share your store link', desc: 'Post in Instagram, WhatsApp, TikTok' },
  { title: 'Wait for orders', desc: "You'll get notified in real-time" },
  { title: 'Get paid daily', desc: 'Earnings go to your Cash App' },
];

export function ProductAddedSuccess({
  productName,
  onAddAnother,
  onGoToDashboard,
}: {
  productName: string;
  onAddAnother: () => void;
  onGoToDashboard: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-md py-12 text-center lg:py-20">
      <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-primary">
        <Icon i="check" size={32} className="text-primary-foreground" />
      </div>

      <h1
        className="mb-3 font-headings font-bold text-foreground"
        style={{ fontSize: '28px', letterSpacing: '-0.8px' }}
      >
        Product added!
      </h1>
      <p className="mx-auto mb-10 max-w-sm text-base leading-relaxed text-muted-foreground">
        {productName} is now live on your store. Customers can start ordering.
      </p>

      <div className="space-y-3">
        <Button onClick={onAddAnother} className="w-full py-3 text-base">
          Add Another Product
        </Button>
        <Button variant="outline" onClick={onGoToDashboard} className="w-full py-3 text-base">
          Go to Dashboard
        </Button>
      </div>

      <div className="mt-12 border-t border-border pt-8 text-left">
        <p className="mb-6 text-center text-xs uppercase tracking-wide text-muted-foreground">
          What&apos;s next?
        </p>
        <div className="space-y-4">
          {NEXT_STEPS.map((step, i) => (
            <div key={step.title} className="flex items-start gap-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-accent">
                {i + 1}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
