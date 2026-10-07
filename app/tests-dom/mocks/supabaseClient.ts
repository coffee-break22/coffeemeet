import { vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string; details?: string; hint?: string } | null };
type RpcHandler = (params: Record<string, unknown> | undefined) => Result | Promise<Result>;
type TableHandler = () => Result | Promise<Result>;

const ok = (data: unknown = null): Result => ({ data, error: null });

function makeQueryBuilder(resolve: () => Result | Promise<Result>) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    filter: () => builder,
    upsert: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    single: () => Promise.resolve(resolve()),
    maybeSingle: () => Promise.resolve(resolve()),
    then: (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return builder;
}

export interface MockAuthUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  identities?: unknown[];
}

/**
 * Fake Supabase client for component/integration tests. Configure RPC and
 * table responses per test with setRpc/setTable; auth calls resolve using
 * setSession/setSignUpResult so AuthContext behaves like a real session.
 */
export function createSupabaseMock() {
  const rpcHandlers = new Map<string, RpcHandler>();
  const tableHandlers = new Map<string, TableHandler>();
  const authStateListeners: Array<(event: string, session: unknown) => void> = [];
  let currentUser: MockAuthUser | null = null;
  let signUpResult:
    | { ok: true; user: MockAuthUser; session: unknown }
    | { ok: false; error: { code?: string; message: string } } = {
    ok: false,
    error: { message: "SIGN_UP_NOT_CONFIGURED" },
  };

  function emitAuthState(event: string) {
    const session = currentUser ? { user: currentUser } : null;
    for (const listener of authStateListeners) listener(event, session);
  }

  const client = {
    auth: {
      signUp: vi.fn(async () => {
        if (!signUpResult.ok)
          return { data: { user: null, session: null }, error: signUpResult.error };
        currentUser = signUpResult.user;
        emitAuthState("SIGNED_IN");
        return {
          data: { user: signUpResult.user, session: signUpResult.session },
          error: null,
        };
      }),
      signInWithPassword: vi.fn(async ({ email }: { email: string }) => {
        currentUser = { id: `user-${email}`, email, user_metadata: {}, app_metadata: {} };
        emitAuthState("SIGNED_IN");
        return { data: { user: currentUser, session: { user: currentUser } }, error: null };
      }),
      signOut: vi.fn(async () => {
        currentUser = null;
        emitAuthState("SIGNED_OUT");
        return { error: null };
      }),
      getSession: vi.fn(async () => ({
        data: { session: currentUser ? { user: currentUser } : null },
      })),
      onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
        authStateListeners.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(async (name: string, params?: Record<string, unknown>) => {
      const handler = rpcHandlers.get(name);
      return handler ? handler(params) : ok(null);
    }),
    from: vi.fn((table: string) => {
      const handler = tableHandlers.get(table);
      return makeQueryBuilder(handler ?? (() => ok(null)));
    }),
  };

  return {
    client,
    setRpc(name: string, handler: RpcHandler) {
      rpcHandlers.set(name, handler);
    },
    setTable(table: string, handler: TableHandler) {
      tableHandlers.set(table, handler);
    },
    setSignUpUser(user: MockAuthUser) {
      signUpResult = { ok: true, user, session: { user } };
    },
    setSignUpError(message: string, code?: string) {
      signUpResult = { ok: false, error: { message, code } };
    },
    setLoggedIn(user: MockAuthUser) {
      currentUser = user;
    },
  };
}
