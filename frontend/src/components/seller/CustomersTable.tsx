import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { formatUsd } from '@/components/seller/OrdersTable';

export interface SellerCustomer {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  address: Record<string, unknown> | null;
  totalSpentCents: number;
  ordersCount: number;
  createdAt: string;
}

export function CustomersTable({ customers }: { customers: SellerCustomer[] }) {
  if (customers.length === 0) {
    return (
      <div className="py-16 text-center">
        <Icon i="users" size={32} className="mx-auto mb-4 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">
          No customers yet. They show up here once their first order is paid.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {customers.map((customer) => (
        <Link
          key={customer.id}
          href={`/dashboard/customers/${customer.id}`}
          className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 hover:border-primary"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              {customer.name ?? 'Guest'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[customer.phone, customer.email].filter(Boolean).join(' · ') || 'No contact info'}
            </p>
          </div>
          <div className="w-28 flex-shrink-0 text-right">
            <p className="text-sm font-bold text-foreground">
              {formatUsd(customer.totalSpentCents)}
            </p>
            <p className="text-xs text-muted-foreground">
              {customer.ordersCount} order{customer.ordersCount === 1 ? '' : 's'}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
