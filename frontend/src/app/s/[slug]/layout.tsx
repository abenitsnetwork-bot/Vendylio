import { headers } from 'next/headers';

// The public storefront always renders LIGHT — it's the customer's view,
// styled by the merchant's chosen template, and must not inherit the
// merchant's personal light/dark preference. The root pre-paint script only
// themes an allowlist of app routes (never `/s/*` or `/` on a custom domain),
// so this is a belt-and-braces re-assert of light for the storefront subtree.
const STOREFRONT_THEME_LOCK = `(function(){try{document.documentElement.dataset.theme='light';}catch(e){}})();`;

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: STOREFRONT_THEME_LOCK }} />
      {children}
    </>
  );
}
