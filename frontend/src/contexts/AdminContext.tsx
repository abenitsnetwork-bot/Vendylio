'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';

export interface AdminInfo {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPERADMIN';
}

export type AdminAuthError = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NETWORK' | null;

interface AdminContextValue {
  admin: AdminInfo | null;
  /** Capability hints from GET /api/admin/me — presentational only, every
   * mutating route re-checks role server-side (see that route's header
   * comment). Use to show/hide buttons, never as the actual authorization. */
  can: string[];
  loading: boolean;
  error: AdminAuthError;
  refresh: () => Promise<void>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

/**
 * Phase 10 — the admin back-office reuses the exact same cookie session as
 * the seller dashboard (an admin is just a User row with role ADMIN /
 * SUPERADMIN); this Provider is the admin-specific layer on top, probing
 * GET /api/admin/me for role + capability hints. A 401 means "not logged in
 * at all" (redirect to /login); a 403 means "logged in but not an admin"
 * (show Access Denied, no redirect — they may have a perfectly valid
 * seller session).
 */
export function AdminProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [can, setCan] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminAuthError>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ admin: AdminInfo; can: string[] }>('/api/admin/me');
      setAdmin(res.admin);
      setCan(res.can);
    } catch (err) {
      setAdmin(null);
      setCan([]);
      if (err instanceof ApiError && err.status === 401) setError('UNAUTHENTICATED');
      else if (err instanceof ApiError && err.status === 403) setError('FORBIDDEN');
      else setError('NETWORK');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminContext.Provider value={{ admin, can, loading, error, refresh: load }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdminAuth(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdminAuth must be used inside an AdminProvider');
  return ctx;
}
