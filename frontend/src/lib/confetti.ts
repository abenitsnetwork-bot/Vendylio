// Celebratory confetti burst — used for the "Welcome to Pro" moment.
//
// `canvas-confetti` is bundled (no CDN — CSP-safe). Imported lazily so it
// stays out of the main bundle until something actually celebrates. Honours
// `prefers-reduced-motion` and is a no-op on the server.

// On-brand palette: coral accent + forest teal + a couple of vivid pops.
const COLORS = ['#dd5b2e', '#16322d', '#14b8a6', '#f4a259', '#e11d74', '#ffffff'];

export async function celebrate(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const confetti = (await import('canvas-confetti')).default;

  // One big centre burst…
  confetti({
    particleCount: 130,
    spread: 90,
    startVelocity: 45,
    origin: { y: 0.55 },
    colors: COLORS,
    scalar: 1.1,
  });

  // …then a ~1s stream from both bottom corners.
  const end = Date.now() + 1000;
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.9 }, colors: COLORS });
    confetti({
      particleCount: 5,
      angle: 120,
      spread: 60,
      origin: { x: 1, y: 0.9 },
      colors: COLORS,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
