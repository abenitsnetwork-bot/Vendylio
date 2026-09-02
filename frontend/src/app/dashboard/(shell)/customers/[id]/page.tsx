'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { StatusBadge, formatUsd, type SellerOrder } from '@/components/seller/OrdersTable';
import { formatOrderNumber } from '@/lib/orderNumber';
import type { SellerCustomer } from '@/components/seller/CustomersTable';

function addressLines(addr: Record<string, unknown> | null): string[] {
  if (!addr) return [];
  const { street, city, state, zip } = addr as Record<string, string | undefined>;
  return [street, [city, state, zip].filter(Boolean).join(', ')].filter((line): line is string =>
    Boolean(line),
  );
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useUser();
  const { logout } = useAuth();
  const [customer, setCustomer] = useState<SellerCustomer | null>(null);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ customer: SellerCustomer; orders: SellerOrder[] }>(`/api/customers/${id}`)
      .then((res) => {
        setCustomer(res.customer);
        setOrders(res.orders);
      })
      .catch((err) => {
        const message =
          err instanceof ApiError && err.code === 'CUSTOMER_NOT_FOUND'
            ? 'This customer no longer exists.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load this customer.';
        setError(message);
      });
  }, [user, id]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerHeader
        userName={sellerFirstName(user)}
        userEmail={user.email}
        onSignOut={async () => {
          await logout();
        }}
      />
      <div className="px-4 py-12 lg:px-14">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/dashboard/customers"
            className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
          >
            <Icon i="arrow-left" size={16} />
            Back to Customers
          </Link>

          {error && !customer && <p className="text-sm text-red-600">{error}</p>}
          {!customer && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

          {customer && (
            <>
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h1
                    className="mb-2 font-headings font-bold text-foreground"
                    style={{ fontSize: 'clamp(22px, 4vw, 30px)', letterSpacing: '-0.6px' }}
                  >
                    {customer.name ?? 'Guest'}
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    {[customer.phone, customer.email].filter(Boolean).join(' · ') ||
                      'No contact info'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-headings text-2xl font-bold text-foreground">
                    {formatUsd(customer.totalSpentCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {customer.ordersCount} order{customer.ordersCount === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {addressLines(customer.address).length > 0 && (
                <Card className="mb-6">
                  <h2 className="mb-3 font-headings text-base font-bold text-foreground">
                    Last known address
                  </h2>
                  {addressLines(customer.address).map((line) => (
                    <p key={line} className="text-sm text-foreground">
                      {line}
                    </p>
                  ))}
                </Card>
              )}

              <Card>
                <h2 className="mb-4 border-b border-border pb-4 font-headings text-base font-bold text-foreground">
                  Orders
                </h2>
                {orders.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No orders on record for this customer.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {orders.map((order) => (
                      <Link
                        key={order.id}
                        href={`/dashboard/orders/${order.id}`}
                        className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 hover:border-accent"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted-foreground">
                            {formatOrderNumber(order.orderNumber)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(order.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <p className="text-sm font-bold text-foreground">
                          {formatUsd(order.amount)}
                        </p>
                        <StatusBadge status={order.status} />
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
