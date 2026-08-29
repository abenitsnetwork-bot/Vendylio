import { describe, it, expect } from 'vitest';
import {
  orderConfirmationEmail,
  orderStatusUpdateEmail,
  orderRefundedEmail,
  type OrderEmailContext,
} from './orderEmails';

const CTX: OrderEmailContext = {
  storeName: "Consty's Kitchen",
  orderReference: 'VND-10042',
  trackingUrl: 'https://app.example.com/s/constys-kitchen/orders/tok_abc123/success',
  customerName: 'Jamie',
  fulfillmentMethod: 'DELIVERY',
  items: [
    { name: 'Chocolate Cake', quantity: 2, unitLabel: 'UNIT', lineTotalCents: 7000 },
    { name: 'Pepper', quantity: 3, unitLabel: 'LB', lineTotalCents: 1500 },
  ],
  totalCents: 8500,
  currency: 'USD',
  storePhone: '555-0100',
  storeUrl: 'https://app.example.com/s/constys-kitchen',
};

describe('orderConfirmationEmail', () => {
  it('is merchant-first and carries the human reference + tracking link', () => {
    const tpl = orderConfirmationEmail(CTX);
    expect(tpl.subject).toBe("Your order from Consty's Kitchen is confirmed — VND-10042");
    expect(tpl.html).toContain('VND-10042');
    expect(tpl.html).toContain('Track your order');
    expect(tpl.html).toContain('tok_abc123');
    expect(tpl.html).toContain('$85.00');
    expect(tpl.text).toContain('VND-10042');
  });

  it('greets by name, or neutrally when absent', () => {
    expect(orderConfirmationEmail(CTX).html).toContain('Hi Jamie,');
    expect(orderConfirmationEmail({ ...CTX, customerName: null }).html).toContain('Hi there,');
  });

  it('escapes HTML in store / product / customer names (§164–166)', () => {
    const tpl = orderConfirmationEmail({
      ...CTX,
      storeName: '<script>alert(1)</script>',
      customerName: '"><img src=x>',
      items: [{ name: '<b>x</b>', quantity: 1, lineTotalCents: 100 }],
    });
    expect(tpl.html).not.toContain('<script>alert(1)</script>');
    expect(tpl.html).not.toContain('<img src=x>');
    expect(tpl.html).toContain('&lt;script&gt;');
  });
});

describe('orderStatusUpdateEmail', () => {
  it('picks the copy for each milestone', () => {
    expect(orderStatusUpdateEmail(CTX, 'PREPARING').subject).toContain('being prepared');
    expect(orderStatusUpdateEmail(CTX, 'ON_THE_WAY').subject).toContain('on the way');
    expect(orderStatusUpdateEmail(CTX, 'DELIVERED').subject).toContain('has been delivered');
  });

  it('READY wording differs for pickup vs delivery', () => {
    expect(orderStatusUpdateEmail({ ...CTX, fulfillmentMethod: 'PICKUP' }, 'READY').html).toContain(
      'ready for pickup',
    );
    expect(orderStatusUpdateEmail(CTX, 'READY').html).toContain('on its way shortly');
  });

  it('delivery-issue copy is calm and never exposes provider errors (§22/§49)', () => {
    const tpl = orderStatusUpdateEmail(CTX, 'DELIVERY_ISSUE');
    expect(tpl.html).toContain('has been notified');
    expect(tpl.html.toLowerCase()).not.toContain('error');
    expect(tpl.html.toLowerCase()).not.toContain('uber');
  });
});

describe('orderRefundedEmail', () => {
  it('explains the refund timing and has no tracking CTA', () => {
    const tpl = orderRefundedEmail(CTX);
    expect(tpl.subject).toContain('refunded');
    expect(tpl.html).toContain('5–10 business days');
    expect(tpl.html).not.toContain('Track your order');
  });
});
