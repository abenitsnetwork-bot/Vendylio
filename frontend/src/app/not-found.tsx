import Link from 'next/link';

// Rendered by Next for unmatched routes AND wherever server code calls
// `notFound()` — the admin layout uses it to make /admin indistinguishable
// from a dead URL for anyone who isn't a signed-in admin.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center font-body">
      <p
        className="font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(28px, 6vw, 40px)', letterSpacing: '-0.8px' }}
      >
        Page not found
      </p>
      <p className="text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
      >
        Back to home
      </Link>
    </main>
  );
}
