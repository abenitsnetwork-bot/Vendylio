'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

const LINKS = [
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#features', label: 'Features' },
  { href: '#testimonials', label: 'Reviews' },
];

export function PublicNavBar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card font-body">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 lg:px-14">
        <Link href="/" className="flex items-center">
          <img src="/logo.png" alt="Vendylio" className="h-10 w-auto" />
        </Link>

        <nav className="hidden items-center gap-8 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Open Store Now
          </Link>
        </div>

        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center text-foreground lg:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon i={open ? 'x' : 'menu'} size={22} />
        </button>
      </div>

      {open && (
        <div className="border-t border-border px-4 py-4 lg:hidden">
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Log in
            </Link>
            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-full bg-primary px-3 py-3 text-center text-sm font-semibold text-primary-foreground"
            >
              Open Store Now
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
