import { headers } from 'next/headers';

// The public storefront always renders LIGHT — it's the customer's view,
// styled by the merchant's chosen template, and must not inherit the
// merchant's personal light/dark preference. On the platform domain the
// pre-paint script in the root layout already skips `/s/*`; on a connected
// custom domain the browser path is `/`, so this layout re-asserts light and
// drops a marker the ThemeProvider reads to stop re-applying dark.
const STOREFRONT_THEME_LOCK = `(function(){try{var d=document.documentElement;d.dataset.storefront='1';d.dataset.theme='light';}catch(e){}})();`;

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: STOREFRONT_THEME_LOCK }} />
      {children}
    </>
  );
}
