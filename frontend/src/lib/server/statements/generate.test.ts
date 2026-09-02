import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./build', () => ({ buildStatementForWithdrawal: vi.fn() }));

import { buildStatementForWithdrawal } from './build';
import { generateStatementForWithdrawal } from './generate';

const mockBuild = vi.mocked(buildStatementForWithdrawal);

beforeEach(() => vi.clearAllMocks());

describe('generateStatementForWithdrawal', () => {
  it('is a no-op when a statement already exists', async () => {
    prismaMock.withdrawalStatement.findUnique.mockResolvedValue({ id: 'st-1' } as never);
    await generateStatementForWithdrawal('wd-1');
    expect(mockBuild).not.toHaveBeenCalled();
    expect(prismaMock.withdrawalStatement.create).not.toHaveBeenCalled();
  });

  it('does nothing when the builder returns null', async () => {
    prismaMock.withdrawalStatement.findUnique.mockResolvedValue(null as never);
    mockBuild.mockResolvedValue(null);
    await generateStatementForWithdrawal('wd-1');
    expect(prismaMock.withdrawalStatement.create).not.toHaveBeenCalled();
  });

  it('persists the built statement', async () => {
    prismaMock.withdrawalStatement.findUnique.mockResolvedValue(null as never);
    mockBuild.mockResolvedValue({
      storeId: 'store-1',
      data: { schemaVersion: 1, storeSlug: 'x' } as never,
      periodFrom: new Date('2026-02-01T00:00:00Z'),
      periodTo: new Date('2026-03-01T00:00:00Z'),
      currency: 'USD',
      grossSalesCents: 16000,
      totalDeductionsCents: 2000,
      netPayableCents: 8150,
    });

    await generateStatementForWithdrawal('wd-1');

    const arg = prismaMock.withdrawalStatement.create.mock.calls[0]?.[0]?.data;
    expect(arg).toMatchObject({
      withdrawalId: 'wd-1',
      storeId: 'store-1',
      currency: 'USD',
      grossSalesCents: 16000,
      totalDeductionsCents: 2000,
      netPayableCents: 8150,
    });
  });

  it('swallows a persistence error (best-effort)', async () => {
    prismaMock.withdrawalStatement.findUnique.mockResolvedValue(null as never);
    mockBuild.mockResolvedValue({
      storeId: 'store-1',
      data: {} as never,
      periodFrom: new Date(),
      periodTo: new Date(),
      currency: 'USD',
      grossSalesCents: 0,
      totalDeductionsCents: 0,
      netPayableCents: 0,
    });
    prismaMock.withdrawalStatement.create.mockRejectedValue(new Error('P2002'));
    await expect(generateStatementForWithdrawal('wd-1')).resolves.toBeUndefined();
  });
});
