'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { WhatsAppIcon, InstagramIcon, TikTokIcon } from '@/components/ui/BrandIcon';
import { Button } from '@/components/ui/Button';
import { StoreQrCode } from './StoreQrCode';

// Instagram and TikTok have no public web-intent for sharing a prefilled
// link — unlike WhatsApp/email, there's no URL scheme to open a composer
// with the store link already in it. Those two chips copy the link instead
// and tell the seller to paste it manually, rather than linking to a URL
// that doesn't do what the label implies.
const COPY_ONLY_CHANNELS = new Set(['Instagram', 'TikTok']);

export function ShareStoreModal({ storeUrl, onClose }: { storeUrl: string; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copyLink(tag: string) {
    try {
      await navigator.clipboard.writeText(storeUrl);
      setCopied(tag);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard API can be unavailable — no-op.
    }
  }

  const INSTAGRAM_GRADIENT: CSSProperties = {
    background:
      'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)',
  };

  const channels: {
    label: string;
    href?: string;
    circle: string;
    circleStyle?: CSSProperties;
    glyph: ReactNode;
  }[] = [
    {
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encodeURIComponent(storeUrl)}`,
      circle: 'bg-[#25D366]',
      glyph: <WhatsAppIcon size={20} className="text-white" />,
    },
    {
      label: 'Email',
      href: `mailto:?body=${encodeURIComponent(storeUrl)}`,
      circle: 'bg-[#2563EB]',
      glyph: <Icon i="mail" size={18} className="text-white" />,
    },
    {
      label: 'Instagram',
      circle: '',
      circleStyle: INSTAGRAM_GRADIENT,
      glyph: <InstagramIcon size={20} className="text-white" />,
    },
    {
      label: 'TikTok',
      circle: 'bg-[#010101]',
      glyph: <TikTokIcon size={19} className="text-white" />,
    },
    {
      label: 'Copy Link',
      circle: 'bg-secondary',
      glyph: <Icon i="link" size={18} className="text-foreground" />,
    },
  ];

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-headings text-lg font-bold text-foreground">Share Your Store</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground"
          aria-label="Close"
        >
          <Icon i="x" size={18} />
        </button>
      </div>

      <div className="mb-8 rounded-lg border border-border bg-secondary p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          Your store link
        </p>
        <div className="flex items-center justify-between gap-2">
          <code className="break-all font-mono text-sm text-foreground">{storeUrl}</code>
          <button
            type="button"
            onClick={() => copyLink('main')}
            className="flex-shrink-0 rounded bg-secondary px-3 py-2 text-xs font-semibold text-foreground"
          >
            {copied === 'main' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="mb-8 flex flex-col items-center gap-2">
        <StoreQrCode url={storeUrl} size={140} />
        <p className="text-xs text-muted-foreground">Scan in person or print for your counter</p>
      </div>

      <div className="mb-8">
        <p className="mb-4 text-xs uppercase tracking-wide text-muted-foreground">Share to</p>
        <div className="grid grid-cols-3 gap-3">
          {channels.map((channel) => {
            const copyOnly = COPY_ONLY_CHANNELS.has(channel.label) || channel.label === 'Copy Link';
            const justCopied = copied === channel.label;
            const content = (
              <>
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    justCopied ? 'bg-green-500' : channel.circle
                  }`}
                  style={justCopied ? undefined : channel.circleStyle}
                >
                  {justCopied ? <Icon i="check" size={18} className="text-white" /> : channel.glyph}
                </div>
                <span className="text-center text-xs font-medium text-foreground">
                  {justCopied ? 'Copied!' : channel.label}
                </span>
              </>
            );
            if (copyOnly) {
              return (
                <button
                  key={channel.label}
                  type="button"
                  onClick={() => copyLink(channel.label)}
                  className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-secondary"
                >
                  {content}
                </button>
              );
            }
            return (
              <a
                key={channel.label}
                href={channel.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 transition-colors hover:bg-secondary"
              >
                {content}
              </a>
            );
          })}
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-border bg-secondary p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Tips to get more sales:</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="mt-0.5 flex-shrink-0">•</span>
            <span>Pin it in your Instagram bio</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 flex-shrink-0">•</span>
            <span>Share to your WhatsApp status daily</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-0.5 flex-shrink-0">•</span>
            <span>Add it to your group descriptions</span>
          </li>
        </ul>
      </div>

      <Button variant="outline" onClick={onClose} className="w-full">
        Done
      </Button>
    </div>
  );
}
