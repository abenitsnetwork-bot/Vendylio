import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { getPlatformCommissionRates } from './platform-settings';

beforeEach(() => {
  prismaMock.platformSettings.findUnique.mockReset();
});

describe('getPlatformCommissionRates', () => {
  it('returns 0% / null when no row exists yet', async () => {
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce(null);
    const rates = await getPlatformCommissionRates(prismaMock);
    expect(rates).toEqual({ baseRateBp: 0, proRateBp: null });
  });

  it('returns the stored rates when a row exists', async () => {
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      commissionRateBp: 600,
      commissionRateBpPro: 300,
      updatedAt: new Date(),
    } as never);
    const rates = await getPlatformCommissionRates(prismaMock);
    expect(rates).toEqual({ baseRateBp: 600, proRateBp: 300 });
  });

  it('reads the singleton row by id "default"', async () => {
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce(null);
    await getPlatformCommissionRates(prismaMock);
    expect(prismaMock.platformSettings.findUnique).toHaveBeenCalledWith({
      where: { id: 'default' },
    });
  });
});
