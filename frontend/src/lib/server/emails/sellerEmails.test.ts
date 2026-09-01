import { describe, it, expect } from 'vitest';
import {
  orderNewSellerEmail,
  orderUnfulfilledReminderEmail,
  type SellerOrderEmailContext,
} from './sellerEmails';

const CTX: SellerOrderEmailContext = {
  storeName: "Consty's Kitchen",
  orderReference: 'VND-10042',
  dashboardUrl: 'https://vendylio.example/dashboard/orders/order-1',
  customerName: 'Jamie <script>',
  customerPhone: '555-0100',
  fulfillmentMethod: 'DELIVERY',
  deliveryAddress: '1 Main St, Dakar, DK, 10001',
  items: [{ name: 'Shea Butter', quantity: 2, unitLabel: 'UNIT', lineTotalCents: 3600 }],
  totalCents: 3600,
  currency: 'USD',
};

describe('sellerEmails', () => {
  it('orderNewSellerEmail carries the reference, total, contact + dashboard CTA', () => {
    const tpl = orderNewSellerEmail(CTX);
    expect(tpl.subject).toContain('VND-10042');
    expect(tpl.subject).toContain('$36.00');
    expect(tpl.html).toContain('/dashboard/orders/order-1');
    expect(tpl.html).toContain('555-0100');
    expect(tpl.text).toContain('1 Main St, Dakar, DK, 10001');
  });

  it('escapes user-controlled values (no raw <script>)', () => {
    const tpl = orderNewSellerEmail(CTX);
    expect(tpl.html).not.toContain('<script>');
    expect(tpl.html).toContain('&lt;script&gt;');
  });

  it('orderUnfulfilledReminderEmail names the wait and links the order', () => {
    const tpl = orderUnfulfilledReminderEmail(CTX, 9);
    expect(tpl.subject).toContain('VND-10042');
    expect(tpl.html).toContain('9 hours');
    expect(tpl.html).toContain('/dashboard/orders/order-1');
  });

  it('pickup orders never render a delivery address line', () => {
    const tpl = orderNewSellerEmail({ ...CTX, fulfillmentMethod: 'PICKUP', deliveryAddress: null });
    expect(tpl.html).toContain('collect this order in person');
    expect(tpl.html).not.toContain('1 Main St');
  });
});
