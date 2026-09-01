import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { requirePro } from './require-pro';

describe('requirePro (Phase 1a)', () => {
  it('returns null (proceed) for a PRO store', () => {
    expect(requirePro({ plan: 'PRO' }, 'promoCodes')).toBeNull();
  });

  it('returns a 402 NextResponse for a FREE store', async () => {
    const res = requirePro({ plan: 'FREE' }, 'promoCodes');
    expect(res).toBeInstanceOf(NextResponse);
    expect(res!.status).toBe(402);
    const body = await res!.json();
    expect(body.error).toBe('PLAN_UPGRADE_REQUIRED');
    expect(body.feature).toBe('promoCodes');
  });

  it('returns a 402 for a null store (no store / no plan)', () => {
    const res = requirePro(null, 'customDomain');
    expect(res).toBeInstanceOf(NextResponse);
    expect(res!.status).toBe(402);
  });

  it('an unknown plan string is treated as not-Pro', () => {
    expect(requirePro({ plan: 'LEGACY' }, 'teamMembers')).toBeInstanceOf(NextResponse);
  });
});
