import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import {
  isSupabaseConfigured,
  supabase,
} from "../../infrastructure/supabase/client.ts";
import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
} from "./authStore.ts";
const DEMO_KEY = "coffeemeet.demo-auth.v1";
const mapUser = (user: User): AuthUser => ({
  id: user.id,
  email: user.email ?? "",
  name: String(user.user_metadata.full_name ?? user.user_metadata.name ?? ""),
  provider: String(user.app_metadata.provider ?? "email"),
  demo: false,
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
      if (isSupabaseConfigured) return null;
      try {
        return JSON.parse(localStorage.getItem(DEMO_KEY) ?? "null");
      } catch {
        return null;
      }
    }),
    [loading, setLoading] = useState(isSupabaseConfigured),
    [isAdmin, setIsAdmin] = useState(false),
    [verificationStatus, setVerificationStatus] = useState<
      "pending" | "approved" | "rejected"
    >("pending");
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const apply = async (next: User | null) => {
      let admin = false;
      let status: "pending" | "approved" | "rejected" = "pending";
      if (next) {
        const [role, profile] = await Promise.all([
          client.rpc("current_user_is_admin"),
          client
            .from("profiles")
            .select("verification_status")
            .eq("id", next.id)
            .maybeSingle(),
        ]);
        admin = Boolean(role.data);
        status = profile.data?.verification_status ?? "pending";
      }
      setIsAdmin(admin);
      setVerificationStatus(status);
      setUser(next ? mapUser(next) : null);
      setLoading(false);
    };
    void client.auth
      .getSession()
      .then(({ data }) => apply(data.session?.user ?? null));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      void apply(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const client = supabase;
    if (!client || !user || isAdmin) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void client
        .from("profiles")
        .select("verification_status")
        .eq("id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (active && data?.verification_status)
            setVerificationStatus(data.verification_status);
        });
    };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [user, isAdmin]);
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured: isSupabaseConfigured,
      isAdmin,
      verificationStatus,
      async signInWithGoogle() {
        if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${window.location.origin}/admin` },
        });
        if (error) throw error;
      },
      async signInWithPassword(email, password, captchaToken) {
        if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: captchaToken ? { captchaToken } : undefined,
        });
        if (error) throw error;
      },
      async signUp(name, email, password, captchaToken) {
        const client = supabase;
        if (!client) throw new Error("SUPABASE_NOT_CONFIGURED");
        const signInExisting = async () => {
          const { data: existing, error: signInError } =
            await client.auth.signInWithPassword({
              email,
              password,
              options: captchaToken ? { captchaToken } : undefined,
            });
          if (signInError || !existing.user)
            throw new Error("EMAIL_ALREADY_REGISTERED");
          const mapped = mapUser(existing.user);
          setUser(mapped);
          return mapped;
        };
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, captchaToken },
        });
        if (error) {
          if (
            error.code === "user_already_exists" ||
            error.message.toLowerCase().includes("already registered")
          )
            return signInExisting();
          throw new Error(error.code ?? error.message);
        }
        if (
          data.user &&
          !data.session &&
          Array.isArray(data.user.identities) &&
          data.user.identities.length === 0
        )
          return signInExisting();
        if (!data.user || !data.session)
          throw new Error("EMAIL_CONFIRMATION_MUST_BE_DISABLED");
        const mapped = mapUser(data.user);
        setUser(mapped);
        return mapped;
      },
      async signOut() {
        if (supabase) {
          const { error } = await supabase.auth.signOut();
          if (error) throw error;
        } else localStorage.removeItem(DEMO_KEY);
        setUser(null);
        setIsAdmin(false);
        setVerificationStatus("pending");
      },
      async requestPasswordReset(email, captchaToken) {
        if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/?view=reset-password`,
          captchaToken,
        });
        if (error) throw error;
      },
      async updatePassword(password) {
        if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      },
      startLocalDemo(email) {
        if (isSupabaseConfigured) return;
        const demo = {
          id: `demo-${email.toLowerCase()}`,
          email,
          name: "Usuario local",
          provider: "demo",
          demo: true,
        };
        localStorage.setItem(DEMO_KEY, JSON.stringify(demo));
        setUser(demo);
      },
    }),
    [user, loading, isAdmin, verificationStatus],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
