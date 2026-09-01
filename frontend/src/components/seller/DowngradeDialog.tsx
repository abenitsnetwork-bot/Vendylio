'use client';

import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';

// Phase 5 — a "here's what you lose" interstitial before the merchant is sent
// to the Stripe portal to cancel Pro. The actual cancel still happens in
// Stripe's hosted portal (proration + effective date included).

const LOSSES = [
  'Card fee goes back to 5% (from 1.5%)',
  'Cash App / Zelle fee goes back to 5%',
  'Courier delivery (DoorDash / Uber Direct) turns off',
  'Promo codes can no longer be created',
  'Storefront analytics is hidden',
  'Custom domain disconnects',
  'Team members lose access',
  'Hero images drop from 3 to 1',
  'AI product descriptions limited to 5 / month',
  'The "Powered by Vendylio" badge comes back',
];

export function DowngradeDialog({
  onClose,
  onContinue,
  periodEnd,
  busy,
}: {
  onClose: () => void;
  onContinue: () => void;
  periodEnd: string | null;
  busy: boolean;
}) {
  return (
    <Modal onClose={onClose}>
      <div className="max-w-md p-6">
        <h2 className="mb-2 font-headings text-lg font-bold text-foreground">Cancel Pro?</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {periodEnd
            ? `Pro stays active until ${new Date(periodEnd).toLocaleDateString()} — you can keep using everything until then.`
            : 'Your Pro features stay active until the end of the current billing period.'}{' '}
          After that:
        </p>
        <ul className="mb-5 space-y-1.5 text-sm text-muted-foreground">
          {LOSSES.map((l) => (
            <li key={l} className="flex gap-2">
              <Icon i="x" size={14} className="mt-0.5 flex-shrink-0 text-red-500" />
              {l}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Keep Pro
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Continue to cancel'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
