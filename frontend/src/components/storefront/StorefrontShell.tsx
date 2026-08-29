'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PublicStore } from '@/lib/server/storefront';
import { CartProvider, useCart } from '@/contexts/CartContext';
import { Icon } from '@/components/ui/Icon';
import { CartDrawer } from '@/components/storefront/CartDrawer';
import { StorefrontFulfillmentToggle } from '@/components/storefront/StorefrontFulfillmentToggle';
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

function AnnouncementStrip({ text }: { text: string | null }) {
  const value = text?.trim();
  if (!value) return null;
  return (
    <div className="bg-accent px-4 py-2 text-center text-xs font-semibold text-accent-foreground lg:px-14">
      {value}
    </div>
  );
}

function StoreStatusBanner({ store }: { store: PublicStore }) {
  if (!store.acceptingOrders) {
    return (
      <div
        role="status"
        className="bg-foreground px-4 py-2.5 text-center text-sm font-medium text-background lg:px-14"
      >
        {store.pauseMessage?.trim()
          ? store.pauseMessage.trim()
          : `${store.name} isn’t accepting orders right now.`}
      </div>
    );
  }
  if (store.openState.hoursConfigured && !store.openState.openNow) {
    return (
      <div
        role="status"
        className="bg-secondary px-4 py-2.5 text-center text-sm font-medium text-foreground lg:px-14"
      >
        Currently closed{store.openState.nextOpenLabel ? ` · ${store.openState.nextOpenLabel}` : ''}
        . You can still place an order for later.
      </div>
    );
  }
  return null;
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
        <AnnouncementStrip text={store.announcement} />
        <StoreStatusBanner store={store} />
        {store.acceptingOrders && (
          <StorefrontFulfillmentToggle
            deliveryFeeCents={store.deliveryFeeCents}
            deliveryProvider={store.deliveryProvider}
            pickupAddress={store.pickupAddress}
          />
        )}
        <Template store={store} onOpenCart={() => setCartOpen(true)} />
        <footer className="border-t border-border px-4 py-6 text-center lg:px-14">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <img src="/vendylio-icon.svg" alt="" className="h-4 w-4" />
            Powered by Vendylio
          </Link>
        </footer>
        <CartButton onClick={() => setCartOpen(true)} />
        {cartOpen && (
          <CartDrawer
            storeSlug={store.slug}
            acceptingOrders={store.acceptingOrders}
            notAcceptingMessage={
              store.pauseMessage?.trim() || `${store.name} isn’t accepting orders right now.`
            }
            onClose={() => setCartOpen(false)}
          />
        )}
      </div>
    </CartProvider>
  );
}
