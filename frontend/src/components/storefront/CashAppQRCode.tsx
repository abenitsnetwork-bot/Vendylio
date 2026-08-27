'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Cash App's documented deep-link format — scanning it (or opening it on a
 * phone with Cash App installed) takes the payer straight to a pre-filled
 * payment screen for this exact amount. `cashtag` is stored without the
 * leading "$" (see Store.cashAppCashtag), added back here. */
export function cashAppPaymentUrl(cashtag: string, amountCents: number): string {
  const dollars = (amountCents / 100).toFixed(2);
  return `https://cash.app/$${cashtag}/${dollars}`;
}

export function CashAppQRCode({ cashtag, amountCents }: { cashtag: string; amountCents: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const paymentUrl = cashAppPaymentUrl(cashtag, amountCents);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(paymentUrl, { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [paymentUrl]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center">
      {dataUrl ? (
        <img src={dataUrl} alt={`Cash App QR code for $${cashtag}`} className="h-44 w-44" />
      ) : (
        <div className="flex h-44 w-44 items-center justify-center rounded-lg bg-secondary text-xs text-muted-foreground">
          Generating…
        </div>
      )}
      <p className="text-sm font-semibold text-foreground">Scan with Cash App</p>
      <a href={paymentUrl} className="text-sm text-primary hover:underline">
        Or pay ${cashtag} directly
      </a>
    </div>
  );
}
