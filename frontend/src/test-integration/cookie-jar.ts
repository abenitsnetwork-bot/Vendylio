// frontend/src/test-integration/cookie-jar.ts — a stateful in-memory cookie
// store shaped like next/headers `cookies()`. Kept in its OWN module with zero
// app imports: the `vi.mock('next/headers')` factory in setup.ts imports this,
// and so does harness.ts — routing it through a module that pulls in
// @/lib/server/auth (which itself imports next/headers) would deadlock the
// mock factory against a half-evaluated module.
interface JarEntry {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

const jar = new Map<string, JarEntry>();

export function cookieJar() {
  return {
    get(name: string): { name: string; value: string } | undefined {
      const e = jar.get(name);
      return e ? { name: e.name, value: e.value } : undefined;
    },
    set(name: string, value: string, options?: Record<string, unknown>): void {
      jar.set(name, { name, value, ...(options ? { options } : {}) });
    },
    delete(name: string): void {
      jar.delete(name);
    },
    has(name: string): boolean {
      return jar.has(name);
    },
    getAll(): Array<{ name: string; value: string }> {
      return [...jar.values()].map((e) => ({ name: e.name, value: e.value }));
    },
  };
}

export function resetCookieJar(): void {
  jar.clear();
}
