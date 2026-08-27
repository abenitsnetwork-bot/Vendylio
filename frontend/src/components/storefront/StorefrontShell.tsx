'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PublicStore } from '@/lib/server/storefront';
import { CartProvider, useCart } from '@/contexts/CartContext';
import { Icon } from '@/components/ui/Icon';
import { CartDrawer } from '@/components/storefront/CartDrawer';
import { ModernTemplate } from '@/components/storefront/templates/ModernTemplate';
import { MinimalTemplate } from '@/components/storefront/templates/MinimalTemplate';
import { BoldTemplate } from '@/components/storefront/templates/BoldTemplate';

function CartButton({ onClick }: { onClick: () => void }) {
  const { itemCount } = useCart();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open cart"
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg"
    >
      <Icon i="shopping-bag" size={22} />
      {itemCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
          {itemCount}
        </span>
      )}
    </button>
  );
}

export function StorefrontShell({ store }: { store: PublicStore }) {
  const [cartOpen, setCartOpen] = useState(false);
  const Template =
    store.template === 'MINIMAL'
      ? MinimalTemplate
      : store.template === 'BOLD'
        ? BoldTemplate
        : ModernTemplate;

  return (
    <CartProvider storeSlug={store.slug}>
      <div className="min-h-screen bg-background font-body">
        <Template store={store} onOpenCart={() => setCartOpen(true)} />
        <footer className="border-t border-border px-4 py-6 text-center lg:px-14">
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
            Powered by Vendylio
          </Link>
        </footer>
        <CartButton onClick={() => setCartOpen(true)} />
        {cartOpen && <CartDrawer storeSlug={store.slug} onClose={() => setCartOpen(false)} />}
      </div>
    </CartProvider>
  );
}
