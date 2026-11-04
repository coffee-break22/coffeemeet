import { createSupabaseMock, type MockAuthUser } from "./supabaseClient.ts";

/**
 * Called from inside each test file's `vi.mock(".../infrastructure/supabase/client.ts", ...)`
 * factory. Stashes the mock instance on globalThis (keyed) so the test body can
 * configure/assert on it after the mocked module has been wired up.
 */
export function installSupabaseMock(key = "__supabaseMock") {
  const mock = createSupabaseMock();
  (globalThis as Record<string, unknown>)[key] = mock;
  return { isSupabaseConfigured: true, supabase: mock.client };
}

export function getSupabaseMock(key = "__supabaseMock") {
  return (globalThis as Record<string, unknown>)[
    key
  ] as ReturnType<typeof createSupabaseMock>;
}

export const ADMIN_USER: MockAuthUser = {
  id: "admin-1",
  email: "admin@coffeemeet.org",
  user_metadata: { full_name: "Admin CoffeeMeet" },
  app_metadata: { provider: "google" },
};

/** Configures the mock so AuthContext resolves auth.isAdmin === true. */
export function signInAsAdmin(
  mock: ReturnType<typeof createSupabaseMock>,
  user: MockAuthUser = ADMIN_USER,
) {
  mock.setRpc("current_user_is_admin", () => ({ data: true, error: null }));
  mock.setLoggedIn(user);
}
