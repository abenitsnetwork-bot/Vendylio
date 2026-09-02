import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { formatOrderNumber } from '@/lib/orderNumber';

export interface SellerOrderLineItem {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
  unit?: string;
  variantId?: string;
  variantLabel?: string;
}

export interface SellerOrder {
  id: string;
  orderNumber: number;
  status: string;
  amount: number;
  currency: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  fulfillmentMethod: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  deliveryAddress: Record<string, unknown> | null;
  lineItems: SellerOrderLineItem[];
  provider: string;
  paymentMethod: string | null;
  commissionAmount: number | null;
  netAmount: number | null;
  paidAt: string | null;
  createdAt: string;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-blue-100 text-blue-700',
  PREPARING: 'bg-blue-100 text-blue-700',
  READY: 'bg-blue-100 text-blue-700',
  OUT_FOR_DELIVERY: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-secondary text-muted-foreground',
  FAILED: 'bg-red-100 text-red-700',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded px-3 py-1 text-xs font-semibold ${
        STATUS_STYLES[status] ?? 'bg-secondary text-muted-foreground'
      }`}
    >
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export function OrdersTable({ orders }: { orders: SellerOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="py-16 text-center">
        <Icon i="inbox" size={32} className="mx-auto mb-4 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No orders match this filter.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {orders.map((order) => (
        <Link
          key={order.id}
          href={`/dashboard/orders/${order.id}`}
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 hover:border-accent"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              {formatOrderNumber(order.orderNumber)}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {order.customerName ?? 'Guest'}
            </p>
            <p className="text-xs text-muted-foreground">
              {order.fulfillmentMethod === 'PICKUP' && (
                <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-foreground">
                  Pickup
                </span>
              )}
              {order.lineItems.length} item{order.lineItems.length === 1 ? '' : 's'} ·{' '}
              {new Date(order.createdAt).toLocaleString()}
              {order.status === 'PENDING' &&
                (order.provider === 'cashapp_manual' || order.provider === 'zelle_manual') && (
                  <span className="text-accent">
                    {' '}
                    · Awaiting {order.provider === 'cashapp_manual' ? 'Cash App' : 'Zelle'}{' '}
                    confirmation
                  </span>
                )}
            </p>
          </div>
          <p className="w-20 flex-shrink-0 text-right text-sm font-bold text-foreground">
            {formatUsd(order.amount)}
          </p>
          <div className="w-36 flex-shrink-0 text-right">
            <StatusBadge status={order.status} />
          </div>
        </Link>
      ))}
    </div>
  );
}
