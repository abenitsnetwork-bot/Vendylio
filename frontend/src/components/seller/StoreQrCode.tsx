'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Feature 12 (Prompt #15) — a scannable QR of the storefront URL for the
 * "you're live" moment and the share sheet. A merchant can point a customer's
 * phone at it in person or print it for the counter. Uses the `qrcode` package
 * already bundled for the Cash App QR — no new dependency.
 */
export function StoreQrCode({ url, size = 160 }: { url: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: size * 2, margin: 1 })
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return (
    <div
      className="flex items-center justify-center rounded-xl border border-border bg-card p-3"
      style={{ width: size + 24, height: size + 24 }}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt="QR code linking to your storefront"
          width={size}
          height={size}
          className="h-full w-full"
        />
      ) : (
        <span className="text-xs text-muted-foreground">Generating…</span>
      )}
    </div>
  );
}
