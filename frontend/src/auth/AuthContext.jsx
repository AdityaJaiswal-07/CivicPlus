import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { config } from "../lib/config";
import { createApi } from "../lib/api";
import {
  authErrorMessage,
  createSupabaseClient,
  getRememberPreference,
  setRememberPreference,
} from "../lib/supabase";

const AuthContext = createContext(null);

/**
 * status: "loading" | "anonymous" | "authenticated"
 * me: { id, email, emailVerified, role, profile } from GET /auth/me (the ROLE COMES FROM THE SERVER)
 */
export function AuthProvider({ children }) {
  const [client, setClient] = useState(() => createSupabaseClient(getRememberPreference()));
  const [status, setStatus] = useState(config.isConfigured ? "loading" : "anonymous");
  const [me, setMe] = useState(null);
  const clientRef = useRef(client);
  clientRef.current = client;

  const handleUnauthorized = useCallback(() => {
    clientRef.current?.auth.signOut().catch(() => {});
    setMe(null);
    setStatus("anonymous");
  }, []);

  const api = useMemo(
    () =>
      createApi({
        baseUrl: config.apiBaseUrl,
        getToken: async () => {
          const c = clientRef.current;
          if (!c) return null;
          const { data } = await c.auth.getSession();
          return data.session?.access_token ?? null;
        },
        onUnauthorized: handleUnauthorized,
      }),
    [handleUnauthorized],
  );

  const loadMe = useCallback(async () => {
    const data = await api.get("/auth/me");
    setMe(data);
    setStatus("authenticated");
    return data;
  }, [api]);

  // Follow the Supabase session. On every sign-in / refresh, ask the backend who we are.
  useEffect(() => {
    if (!client) return undefined;
    let cancelled = false;

    client.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        setStatus("anonymous");
        return;
      }
      try {
        await loadMe();
      } catch {
        if (!cancelled) {
          setMe(null);
          setStatus("anonymous");
        }
      }
    });

    const { data: sub } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setMe(null);
        setStatus("anonymous");
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [client, loadMe]);

  const signIn = useCallback(
    async (email, password, remember = true) => {
      let c = clientRef.current;
      if (!c) throw new Error("The app is not configured yet (missing Supabase settings).");
      if (remember !== getRememberPreference()) {
        // Different storage requested: switch to a fresh client that uses it.
        setRememberPreference(remember);
        c.auth.stopAutoRefresh?.();
        c = createSupabaseClient(remember);
        clientRef.current = c;
        setClient(c);
      }
      const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(authErrorMessage(error));
      try {
        return await loadMe();
      } catch (err) {
        await c.auth.signOut().catch(() => {});
        setStatus("anonymous");
        throw err;
      }
    },
    [loadMe],
  );

  /** Public signup ALWAYS creates a citizen: only name, e-mail and password are sent, never a role. */
  const signUp = useCallback(async ({ fullName, email, password }) => {
    const c = clientRef.current;
    if (!c) throw new Error("The app is not configured yet (missing Supabase settings).");
    const { data, error } = await c.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/citizen/login`,
      },
    });
    if (error) throw new Error(authErrorMessage(error));
    // With "Confirm email" ON there is no session until the link is clicked.
    return { needsEmailVerification: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await clientRef.current?.auth.signOut();
    } finally {
      setMe(null);
      setStatus("anonymous");
    }
  }, []);

  const sendPasswordReset = useCallback(async (email) => {
    const c = clientRef.current;
    if (!c) throw new Error("The app is not configured yet (missing Supabase settings).");
    const { error } = await c.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(authErrorMessage(error));
  }, []);

  const updatePassword = useCallback(async (password) => {
    const c = clientRef.current;
    if (!c) throw new Error("The app is not configured yet (missing Supabase settings).");
    const { error } = await c.auth.updateUser({ password });
    if (error) throw new Error(authErrorMessage(error));
  }, []);

  /** Raw Supabase client, used only for Storage uploads with signed tokens. */
  const getSupabase = useCallback(() => clientRef.current, []);

  const value = useMemo(
    () => ({
      status,
      me,
      role: me?.role ?? null,
      api,
      configured: config.isConfigured,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      updatePassword,
      refreshMe: loadMe,
      getSupabase,
    }),
    [status, me, api, signIn, signUp, signOut, sendPasswordReset, updatePassword, loadMe, getSupabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
