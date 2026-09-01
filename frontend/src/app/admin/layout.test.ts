import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tripwire: the /admin gate MUST stay server-side. A refactor that reverts
// layout.tsx to a client-only ('use client') gate would silently start
// serving the admin shell to everyone again — the exact hole this closed.
const layoutSrc = readFileSync(resolve(__dirname, 'layout.tsx'), 'utf8');
const proxySrc = readFileSync(resolve(__dirname, '../../proxy.ts'), 'utf8');

describe('admin layout is a server-enforced gate', () => {
  it('is a server component (no "use client")', () => {
    expect(layoutSrc).not.toMatch(/['"]use client['"]/);
  });

  it('re-checks the role server-side and 404s non-admins', () => {
    expect(layoutSrc).toContain('requireAdmin');
    expect(layoutSrc).toContain('notFound');
  });
});

describe('edge proxy pre-filters /admin', () => {
  it('guards the /admin path prefix', () => {
    expect(proxySrc).toMatch(/\/admin/);
    expect(proxySrc).toContain('guardAdmin');
    expect(proxySrc).toMatch(/status:\s*404/);
  });
});
