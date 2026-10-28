import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../utils/AppError.js';
import type { Env } from './env.js';

/** Untyped Supabase client (we map rows ourselves). */
export type Db = SupabaseClient;

export interface VerifiedUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Everything the API needs from Supabase, behind one interface so tests can
 * replace it and never need real credentials.
 *
 * - verifyToken: asks Supabase Auth to validate the bearer token (signature,
 *   expiry, revocation). We never trust token contents ourselves.
 * - userClient: a client that sends the CALLER'S token, so Postgres RLS and the
 *   SQL functions see the real user. This is the default for all data access.
 * - adminClient: service-role client. Bypasses RLS. Server only, created lazily,
 *   used only where unavoidable (signing storage URLs, reading user e-mails).
 */
export interface SupabaseGateway {
  verifyToken(token: string): Promise<VerifiedUser | null>;
  userClient(token: string): Db;
  adminClient(): Db;
}

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export function createSupabaseGateway(env: Env): SupabaseGateway | null {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const anon = createClient(url, anonKey, CLIENT_OPTIONS);
  let admin: Db | undefined;

  return {
    async verifyToken(token) {
      const { data, error } = await anon.auth.getUser(token);
      if (error || !data.user) {
        const status = (error as { status?: number } | null)?.status;
        // 4xx = the token itself is bad. Anything else = Supabase unreachable.
        if (error && (status === undefined || status >= 500 || status === 429)) {
          throw AppError.unavailable('Authentication service is temporarily unavailable');
        }
        return null;
      }
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        emailVerified: Boolean(data.user.email_confirmed_at),
      };
    },
    userClient(token) {
      return createClient(url, anonKey, {
        ...CLIENT_OPTIONS,
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
    },
    adminClient() {
      const key = env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) throw AppError.unavailable('This operation is not configured on the server');
      admin ??= createClient(url, key, CLIENT_OPTIONS);
      return admin;
    },
  };
}
