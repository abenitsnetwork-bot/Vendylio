import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tripwire: the /admin gate MUST stay server-side. A refactor that reverts
// layout.tsx to a client-only ('use client') gate would silently start
// serving the admin shell to everyone again — the exact hole this closed.
const layoutSrc = readFileSync(resolve(__dirname, 'layout.tsx'), 'utf8');
const middlewareSrc = readFileSync(resolve(__dirname, '../../../middleware.ts'), 'utf8');

describe('admin layout is a server-enforced gate', () => {
  it('is a server component (no "use client")', () => {
    expect(layoutSrc).not.toMatch(/['"]use client['"]/);
  });

  it('re-checks the role server-side and 404s non-admins', () => {
    expect(layoutSrc).toContain('requireAdmin');
    expect(layoutSrc).toContain('notFound');
  });
});

describe('edge middleware pre-filters /admin', () => {
  it('guards the /admin path prefix', () => {
    expect(middlewareSrc).toMatch(/\/admin/);
    expect(middlewareSrc).toContain('guardAdmin');
    expect(middlewareSrc).toMatch(/status:\s*404/);
  });
});
