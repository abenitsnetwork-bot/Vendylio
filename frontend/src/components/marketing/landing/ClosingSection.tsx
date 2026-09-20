export function ClosingSection() {
  return (
    <section className="closing section-pad">
      <p className="eyebrow">YOUR BUSINESS HAS A NEXT CHAPTER.</p>
      <div className="closing-row">
        <h2>
          Let&rsquo;s open
          <br />
          <em>the door.</em>
        </h2>
        <a href="/register" className="closing-cta" aria-label="Open your Vendylio store">
          <span aria-hidden="true">↗</span>
          <span>Open your store</span>
        </a>
      </div>
      <div className="closing-foot">
        <p>Your business. Online. Delivered.</p>
        <p>Start free. No credit card required.</p>
      </div>
    </section>
  );
}
