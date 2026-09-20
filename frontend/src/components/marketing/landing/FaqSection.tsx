// Copy verbatim from the design reference (already checked against the real
// pricing/fulfilment terms by delivery/Vendylio-Audit-et-Benchmark.md).
const FAQS: [string, string][] = [
  [
    'Do I need to know how to code?',
    'No. Vendylio gives you a store builder for adding products and choosing your storefront theme.',
  ],
  [
    'Can I start for free?',
    'Yes. The Free plan is $0 per month with a 5% platform fee. Payment processing fees are separate. See the current pricing terms before signing up.',
  ],
  [
    'How do Cash App and Zelle payments work?',
    'Customers pay you directly, and you manually confirm receipt before fulfilling the order. The plan’s platform fee still applies.',
  ],
  [
    'Can customers collect their orders?',
    'Yes. Vendylio lists customer pickup, self-delivery and supported local couriers as fulfilment options. Courier services depend on location and availability.',
  ],
  [
    'Can I use my own domain?',
    'Custom domains are included in the Pro plan, alongside advanced analytics, promo codes and team members.',
  ],
  [
    'Where can I check availability?',
    'Review Vendylio’s current signup, pricing and service terms for your business location. Payment and delivery options can vary by market.',
  ],
];

export function FaqSection() {
  return (
    <section className="faq section-pad">
      <div>
        <h2>
          Before your
          <br />
          <em>next chapter.</em>
        </h2>
        <p>Good questions. Straight answers.</p>
      </div>
      <div className="faq-list">
        {FAQS.map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
