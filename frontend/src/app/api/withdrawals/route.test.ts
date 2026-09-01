// Phase 4 Plan 04-01 — RED tests for /api/withdrawals (WD-01..04).
//
// Wave 0 contract: these tests are intentionally RED. The `./route` module
// does not exist yet — Wave 1 will create it.
//
// Mock strategy:
//   - `@/lib/server/withdrawals/lock`: spy on `lockUserTx` so tests can
//     assert it was called as the FIRST statement inside the tx.
//   - `@/lib/server/withdrawals/guards`: stub `validateWithdrawalRequest`
//     per-test to return any `{ ok: false, status, code, message }` from
//     the table-driven 8-codes suite.
//   - `@/lib/server/withdrawals/balance`: stub `createDefaultBalanceComputer`.
//   - `@/lib/server/notifications`: stub `createNotification` so the
//     happy-path doesn't try to dispatch a real notification.
//   - `@/lib/server/auth/pin`: stub `verifyPin` to default-pass.
//   - `@/lib/server/middleware`: stub `requireAuth` to a happy ctx.
//   - `@/lib/server/auth`: stub `verifyCsrf` to null (pass) by default.
//   - `@/lib/server/prisma`: stub `$transaction` to invoke its callback
//     with a synthetic tx client + record the options object so the
//     "advisory lock" test can assert isolationLevel === 'Serializable'.
//
// Stable error code table (D-WD-03, REQUIREMENTS.md WD-02):
//   PIN_NOT_SET, PIN_REQUIRED, PIN_INVALID  → 403
//   AMOUNT_BELOW_MIN, AMOUNT_ABOVE_MAX,
//   DAILY_LIMIT_EXCEEDED, COOLDOWN_ACTIVE,
//   INSUFFICIENT_BALANCE                    → 422
// Status codes mirror `validateWithdrawalRequest`'s `status` field —
// see frontend/src/lib/server/withdrawals/guards.ts.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const lockSpy = vi.fn();
vi.mock('@/lib/server/withdrawals/lock', () => ({
  lockUserTx: lockSpy,
}));

const validateMock = vi.fn();
const loadGuardConfigMock = vi.fn(() => ({
  minAmount: 1000,
  maxAmount: null,
  dailyLimit: null as number | null,
  cooldownHours: 0,
  requirePin: true,
  balanceCheckEnabled: true,
}));
vi.mock('@/lib/server/withdrawals/guards', () => ({
  loadGuardConfigFromEnv: (...a: unknown[]) => loadGuardConfigMock(...(a as [])),
  validateWithdrawalRequest: validateMock,
}));

vi.mock('@/lib/server/withdrawals/balance', () => ({
  createDefaultBalanceComputer: vi.fn(() => async () => 5000),
}));

// Phase 1b — the route resolves the caller's store to net Cash App / Zelle
// commission off the balance. Default: no store → the wrapper is a no-op and
// every pre-Phase-1b assertion still holds. The "commission netting" block
// below overrides these per-test.
const resolveOwnStoreMock = vi.fn(
  async () => null as { id: string; organizationId?: string } | null,
);
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: (...a: unknown[]) => resolveOwnStoreMock(...(a as [])),
}));

// Phase 4a — withdrawals are OWNER-only; the guard is mocked to "is owner"
// for the existing tests (a dedicated test below covers the teammate 403).
const requireStoreOwnerMock = vi.fn(async () => null as unknown);
vi.mock('@/lib/server/team/owner-guard', () => ({
  requireStoreOwner: (...a: unknown[]) => requireStoreOwnerMock(...(a as [])),
}));

const owedCommissionMock = vi.fn(async () => 0);
const planSettlementMock = vi.fn(async () => ({
  settledCents: 0,
  chargeIds: [] as string[],
}));
vi.mock('@/lib/server/commission/owed', () => ({
  owedCommissionCents: (...a: unknown[]) => owedCommissionMock(...(a as [])),
  planCommissionSettlement: (...a: unknown[]) => planSettlementMock(...(a as [])),
}));

const createNotif = vi.fn();
vi.mock('@/lib/server/notifications', () => ({
  createNotification: createNotif,
}));

vi.mock('@/lib/server/auth/pin', () => ({
  verifyPin: vi.fn(async () => true),
}));

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { sub: 'user-1', email: 't@e.com' } })),
}));

vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

// Synthetic tx client — exposed by reference so tests can read .mock.calls.
const txUser = { findUnique: vi.fn(async () => ({ withdrawalPinHash: 'hash' })) };
const txWithdrawal = {
  create: vi.fn(async () => ({
    id: 'w-1',
    userId: 'user-1',
    status: 'PENDING',
    amount: 1000,
    currency: 'USD',
    requestedAt: new Date('2026-05-08T12:00:00Z'),
  })),
  findMany: vi.fn(),
};
const txCommissionCharge = { updateMany: vi.fn(async () => ({ count: 0 })) };
const txClient = {
  user: txUser,
  withdrawal: txWithdrawal,
  commissionCharge: txCommissionCharge,
  notification: { create: vi.fn() },
};

const $transaction = vi.fn(
  async (fn: (tx: typeof txClient) => Promise<unknown>, _opts?: unknown) => {
    return fn(txClient);
  },
);

const findManyTop = vi.fn();
vi.mock('@/lib/server/prisma', () => ({
  prisma: {
    $transaction,
    withdrawal: { findMany: findManyTop },
  },
}));

beforeEach(() => {
  vi.stubEnv('WITHDRAWAL_MIN_AMOUNT', '1000');
  vi.stubEnv('WITHDRAWAL_REQUIRE_PIN', '1');
  vi.stubEnv('WITHDRAWAL_BALANCE_CHECK', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  $transaction.mockClear();
  lockSpy.mockClear();
  validateMock.mockReset();
  findManyTop.mockReset();
  txUser.findUnique.mockClear();
  txWithdrawal.create.mockClear();
  txCommissionCharge.updateMany.mockClear();
  resolveOwnStoreMock.mockReset();
  resolveOwnStoreMock.mockResolvedValue(null);
  requireStoreOwnerMock.mockReset();
  requireStoreOwnerMock.mockResolvedValue(null);
  owedCommissionMock.mockReset();
  owedCommissionMock.mockResolvedValue(0);
  planSettlementMock.mockReset();
  planSettlementMock.mockResolvedValue({ settledCents: 0, chargeIds: [] });
  loadGuardConfigMock.mockReset();
  loadGuardConfigMock.mockReturnValue({
    minAmount: 1000,
    maxAmount: null,
    dailyLimit: null,
    cooldownHours: 0,
    requirePin: true,
    balanceCheckEnabled: true,
  });
});

interface PostBody {
  amount: number;
  currency?: string;
  destination?: Record<string, unknown>;
  pin?: string;
}

function makePostReq(body: Partial<PostBody>) {
  return new Request('http://localhost/api/withdrawals', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': 'test-csrf',
    },
    body: JSON.stringify(body),
  });
}

function makeGetReq(query: string = '') {
  // Route reads `req.nextUrl.searchParams` (CLAUDE.md convention, mirrors
  // app/api/admin/withdrawals/route.ts). Plain `Request` has no `.nextUrl`.
  return new NextRequest(`http://localhost/api/withdrawals${query}`);
}

const validBody: PostBody = {
  amount: 1000,
  currency: 'USD',
  destination: { method: 'CASH_APP', cashtag: '$adaeze_shop' },
  pin: '1234',
};

// ────────────────────────────────────────────────────────────────────────
// Table-driven error codes (D-WD-03 / WD-02)
// ────────────────────────────────────────────────────────────────────────
const codeTable: Array<[string, number]> = [
  ['PIN_NOT_SET', 403],
  ['PIN_REQUIRED', 403],
  ['PIN_INVALID', 403],
  ['AMOUNT_BELOW_MIN', 422],
  ['AMOUNT_ABOVE_MAX', 422],
  ['DAILY_LIMIT_EXCEEDED', 422],
  ['COOLDOWN_ACTIVE', 422],
  ['INSUFFICIENT_BALANCE', 422],
];

describe('POST /api/withdrawals (RED — Wave 1 will turn these green)', () => {
  it('happy path returns 201 PENDING + withdrawalId', async () => {
    validateMock.mockResolvedValueOnce({ ok: true });
    const { POST } = await import('./route');
    const res = await POST(makePostReq(validBody) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.withdrawalId).toBe('w-1');
    expect(body.status).toBe('PENDING');
    expect(lockSpy).toHaveBeenCalled();
  });

  it('advisory lock — Serializable isolation + lockUserTx first', async () => {
    validateMock.mockResolvedValueOnce({ ok: true });
    const { POST } = await import('./route');
    await POST(makePostReq(validBody) as never);
    // Assert tx was opened with Serializable isolation. Wave 1 must pass
    // `{ isolationLevel: 'Serializable' }` to prisma.$transaction(fn, opts).
    const opts = $transaction.mock.calls[0]?.[1] as { isolationLevel?: string } | undefined;
    expect(opts?.isolationLevel).toBe('Serializable');
    expect(lockSpy).toHaveBeenCalled();
    // The lock MUST be the first statement after BEGIN — i.e., before any
    // other tx.* read. Compare invocation order via mock.invocationCallOrder.
    const lockOrder = lockSpy.mock.invocationCallOrder[0];
    const findUserOrder = txUser.findUnique.mock.invocationCallOrder[0];
    if (lockOrder !== undefined && findUserOrder !== undefined) {
      expect(lockOrder).toBeLessThan(findUserOrder);
    }
  });

  it.each(codeTable)('error codes: %s → %i', async (code, status) => {
    validateMock.mockResolvedValueOnce({ ok: false, status, code, message: code });
    const { POST } = await import('./route');
    const res = await POST(makePostReq(validBody) as never);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(code);
  });

  it('invalid body — missing amount returns 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makePostReq({
        currency: 'USD',
        destination: { method: 'CASH_APP', cashtag: '$adaeze_shop' },
        pin: '1234',
      } as Partial<PostBody>) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_BODY');
  });

  it('invalid body — bad cashtag returns 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makePostReq({
        amount: 1000,
        currency: 'USD',
        destination: { method: 'CASH_APP', cashtag: 'no-dollar-sign' },
        pin: '1234',
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_BODY');
  });

  it('invalid body — bad enum returns 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makePostReq({
        amount: 1000,
        currency: 'USD',
        destination: { method: 'NOT_A_METHOD', cashtag: '$adaeze_shop' },
        pin: '1234',
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_BODY');
  });

  it('csrf missing returns 403', async () => {
    const { verifyCsrf } = await import('@/lib/server/auth');
    (verifyCsrf as unknown as Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    const { POST } = await import('./route');
    const res = await POST(makePostReq(validBody) as never);
    expect(res.status).toBe(403);
  });

  it('no auth returns 401', async () => {
    const { requireAuth } = await import('@/lib/server/middleware');
    // requireAuth bails with a NextResponse — route guards via `instanceof NextResponse`.
    (requireAuth as unknown as Mock).mockReturnValueOnce(
      NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makePostReq(validBody) as never);
    expect(res.status).toBe(401);
  });

  it('balance check default — INSUFFICIENT_BALANCE', async () => {
    validateMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      code: 'INSUFFICIENT_BALANCE',
      message: 'Insufficient',
    });
    const { POST } = await import('./route');
    const res = await POST(
      makePostReq({
        ...validBody,
        amount: 999_999_999,
      }) as never,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('balance check disabled — bypasses', async () => {
    vi.stubEnv('WITHDRAWAL_BALANCE_CHECK', '0');
    // When BALANCE_CHECK is off, loadGuardConfigFromEnv returns
    // balanceCheckEnabled=false, validateWithdrawalRequest skips the
    // balance branch, returns ok:true even for excessive amounts.
    validateMock.mockResolvedValueOnce({ ok: true });
    const { POST } = await import('./route');
    const res = await POST(
      makePostReq({
        ...validBody,
        amount: 999_999_999,
      }) as never,
    );
    expect(res.status).toBe(201);
  });
});

describe('GET /api/withdrawals (RED — Wave 1 will turn these green)', () => {
  it('GET own — ordered requestedAt DESC', async () => {
    findManyTop.mockResolvedValueOnce([
      {
        id: 'w-2',
        userId: 'user-1',
        amount: 2000,
        currency: 'USD',
        status: 'PENDING',
        destination: { method: 'CASH_APP', cashtag: '$adaeze_shop' },
        provider: 'manual',
        providerPayoutId: null,
        failureReason: null,
        requestedAt: new Date('2026-05-08T12:00:00Z'),
        processedAt: null,
        completedAt: null,
      },
      {
        id: 'w-1',
        userId: 'user-1',
        amount: 1000,
        currency: 'USD',
        status: 'COMPLETED',
        destination: { method: 'CASH_APP', cashtag: '$adaeze_shop' },
        provider: 'manual',
        providerPayoutId: 'p-1',
        failureReason: null,
        requestedAt: new Date('2026-05-07T12:00:00Z'),
        processedAt: new Date('2026-05-07T12:01:00Z'),
        completedAt: new Date('2026-05-07T12:05:00Z'),
      },
    ]);
    const { GET } = await import('./route');
    const res = await GET(makeGetReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].id).toBe('w-2');
    expect(body.items[1].id).toBe('w-1');
    // PAY-01 — the withdrawable balance rides along on the first page.
    expect(body.availableCents).toBe(5000);
  });

  it('GET cursor — paginates with limit', async () => {
    // Wave 1 contract: with `limit=2`, the route fetches `take: 3` rows
    // and slices to 2 + emits a non-null nextCursor when the slice was
    // shorter than the fetched batch. Subsequent call with the cursor
    // resolves to the trailing row + null cursor.
    findManyTop.mockResolvedValueOnce([
      {
        id: 'w-3',
        userId: 'user-1',
        requestedAt: new Date('2026-05-08T12:00:00Z'),
      },
      {
        id: 'w-2',
        userId: 'user-1',
        requestedAt: new Date('2026-05-07T12:00:00Z'),
      },
      {
        id: 'w-1',
        userId: 'user-1',
        requestedAt: new Date('2026-05-06T12:00:00Z'),
      },
    ]);
    const { GET } = await import('./route');
    const res = await GET(makeGetReq('?limit=2') as never);
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.nextCursor).toBeTruthy();
  });

  it('GET isolation — scope by userId', async () => {
    findManyTop.mockResolvedValueOnce([]);
    const { GET } = await import('./route');
    await GET(makeGetReq() as never);
    // findMany must include `where.userId === auth.user.sub` so user A
    // never sees user B's rows. Inspect the where shape passed to Prisma.
    const args = findManyTop.mock.calls[0]?.[0] as { where?: { userId?: string } } | undefined;
    expect(args?.where?.userId).toBe('user-1');
  });

  it('GET — availableCents is net of OWED Cash App / Zelle commission', async () => {
    findManyTop.mockResolvedValueOnce([]);
    resolveOwnStoreMock.mockResolvedValue({ id: 'store-1' });
    owedCommissionMock.mockResolvedValue(1200);
    const { GET } = await import('./route');
    const res = await GET(makeGetReq() as never);
    const body = await res.json();
    expect(body.commissionOwedCents).toBe(1200);
    expect(body.availableCents).toBe(3800); // 5000 base − 1200 owed
  });
});

// ────────────────────────────────────────────────────────────────────────
// Phase 1b — Cash App / Zelle commission withheld from the payout
// ────────────────────────────────────────────────────────────────────────
describe('POST /api/withdrawals — commission settlement (Phase 1b)', () => {
  it('merchant requests the NET amount, row stores the GROSS debit', async () => {
    validateMock.mockResolvedValueOnce({ ok: true });
    resolveOwnStoreMock.mockResolvedValue({ id: 'store-1' });
    planSettlementMock.mockResolvedValue({ settledCents: 300, chargeIds: ['cc-1', 'cc-2'] });
    txWithdrawal.create.mockResolvedValueOnce({
      id: 'w-9',
      userId: 'user-1',
      status: 'PENDING',
      amount: 1300, // 1000 net + 300 commission
      currency: 'USD',
      requestedAt: new Date('2026-09-01T12:00:00Z'),
    });

    const { POST } = await import('./route');
    const res = await POST(makePostReq(validBody) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.netAmount).toBe(1000);
    expect(body.grossAmount).toBe(1300);
    expect(body.commissionSettledCents).toBe(300);

    // Withdrawal row debits the gross; traceability column carries the cut.
    const createArg = (txWithdrawal.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { amount: number; commissionSettledCents: number };
    };
    expect(createArg.data.amount).toBe(1300);
    expect(createArg.data.commissionSettledCents).toBe(300);

    // The settled charges flip OWED → SETTLED, stamped with this withdrawal.
    const updArg = (txCommissionCharge.updateMany.mock.calls as unknown[][])[0]?.[0] as {
      where: { id: { in: string[] } };
      data: { status: string; settledByWithdrawalId: string };
    };
    expect(updArg.where.id.in).toEqual(['cc-1', 'cc-2']);
    expect(updArg.data.status).toBe('SETTLED');
    expect(updArg.data.settledByWithdrawalId).toBe('w-9');
  });

  it('no store → no settlement, gross === net', async () => {
    validateMock.mockResolvedValueOnce({ ok: true });
    resolveOwnStoreMock.mockResolvedValue(null);
    const { POST } = await import('./route');
    const res = await POST(makePostReq(validBody) as never);
    expect(res.status).toBe(201);
    expect(planSettlementMock).not.toHaveBeenCalled();
    expect(txCommissionCharge.updateMany).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Phase 4a — withdrawals are OWNER-only
// ────────────────────────────────────────────────────────────────────────
describe('POST /api/withdrawals — OWNER-only (Phase 4a)', () => {
  it('403 OWNER_ONLY when a non-owner teammate requests a withdrawal', async () => {
    resolveOwnStoreMock.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    requireStoreOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'OWNER_ONLY', code: 'OWNER_ONLY' }, { status: 403 }) as never,
    );
    const { POST } = await import('./route');
    const res = await POST(
      makePostReq({
        amount: 5000,
        currency: 'USD',
        destination: { method: 'ZELLE', contact: 'me@e.com' },
        pin: '1234',
      }) as never,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('OWNER_ONLY');
    expect(txWithdrawal.create).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Phase 2 — BANK payout (ACH via Stripe Connect)
// ────────────────────────────────────────────────────────────────────────
describe('POST /api/withdrawals — BANK destination (Phase 2)', () => {
  const bankBody: PostBody = {
    amount: 5000,
    currency: 'USD',
    destination: { method: 'BANK' },
    pin: '1234',
  };

  it('422 BANK_PAYOUT_UNAVAILABLE when the store has no ACTIVE Connect account', async () => {
    resolveOwnStoreMock.mockResolvedValue({
      id: 'store-1',
      stripeOnboardingStatus: 'PENDING',
    } as never);
    const { POST } = await import('./route');
    const res = await POST(makePostReq(bankBody) as never);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('BANK_PAYOUT_UNAVAILABLE');
    expect(txWithdrawal.create).not.toHaveBeenCalled();
  });

  it('creates a stripe_transfer withdrawal when the Connect account is ACTIVE', async () => {
    validateMock.mockResolvedValueOnce({ ok: true });
    resolveOwnStoreMock.mockResolvedValue({
      id: 'store-1',
      stripeOnboardingStatus: 'ACTIVE',
    } as never);
    const { POST } = await import('./route');
    const res = await POST(makePostReq(bankBody) as never);
    expect(res.status).toBe(201);
    const createArg = (txWithdrawal.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { provider: string; destination: { method: string } };
    };
    expect(createArg.data.provider).toBe('stripe_transfer');
    expect(createArg.data.destination).toEqual({ method: 'BANK' });
  });

  it('Cash App / Zelle stay on provider "manual"', async () => {
    validateMock.mockResolvedValueOnce({ ok: true });
    resolveOwnStoreMock.mockResolvedValue(null);
    const { POST } = await import('./route');
    await POST(makePostReq(validBody) as never);
    const createArg = (txWithdrawal.create.mock.calls as unknown[][])[0]?.[0] as {
      data: { provider: string };
    };
    expect(createArg.data.provider).toBe('manual');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Phase 3 — plan-aware withdrawal limits
// ────────────────────────────────────────────────────────────────────────
describe('POST /api/withdrawals — plan-aware limits (Phase 3)', () => {
  function guardConfigFromLastCall(): { cooldownHours?: number; dailyLimit?: number | null } {
    const call = (validateMock.mock.calls as unknown[][]).at(-1);
    return (call?.[0] as { config: { cooldownHours?: number; dailyLimit?: number | null } }).config;
  }

  it('FREE store: guard config is the raw env config (cooldown + daily limit kept)', async () => {
    loadGuardConfigMock.mockReturnValueOnce({
      minAmount: 1000,
      maxAmount: null,
      dailyLimit: 20_000,
      cooldownHours: 24,
      requirePin: true,
      balanceCheckEnabled: true,
    });
    validateMock.mockResolvedValueOnce({ ok: true });
    resolveOwnStoreMock.mockResolvedValue({ id: 'store-1', plan: 'FREE' } as never);
    const { POST } = await import('./route');
    await POST(makePostReq(validBody) as never);
    expect(guardConfigFromLastCall().cooldownHours).toBe(24);
    expect(guardConfigFromLastCall().dailyLimit).toBe(20_000);
  });

  it('PRO store: cooldown → 0 and daily limit ×5', async () => {
    loadGuardConfigMock.mockReturnValueOnce({
      minAmount: 1000,
      maxAmount: null,
      dailyLimit: 20_000,
      cooldownHours: 24,
      requirePin: true,
      balanceCheckEnabled: true,
    });
    validateMock.mockResolvedValueOnce({ ok: true });
    resolveOwnStoreMock.mockResolvedValue({ id: 'store-1', plan: 'PRO' } as never);
    const { POST } = await import('./route');
    await POST(makePostReq(validBody) as never);
    expect(guardConfigFromLastCall().cooldownHours).toBe(0);
    expect(guardConfigFromLastCall().dailyLimit).toBe(100_000);
  });

  it('PRO store with no env daily limit: stays null (no cap)', async () => {
    validateMock.mockResolvedValueOnce({ ok: true });
    resolveOwnStoreMock.mockResolvedValue({ id: 'store-1', plan: 'PRO' } as never);
    const { POST } = await import('./route');
    await POST(makePostReq(validBody) as never);
    expect(guardConfigFromLastCall().dailyLimit).toBeNull();
  });
});
