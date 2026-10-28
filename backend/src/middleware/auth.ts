import type { RequestHandler, Response } from 'express';
import type { Db, SupabaseGateway } from '../config/supabase.js';
import { PROFILE_COLUMNS, type ProfileRow, type Role } from '../types/domain.js';
import { AppError } from '../utils/AppError.js';
import { unwrap } from '../utils/dbError.js';

/** Who is calling. Built ONLY from the verified token + the database, never from request input. */
export interface AuthContext {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  role: Role;
  profile: ProfileRow;
  /** Client acting as this user: Postgres RLS and SQL functions apply. */
  db: Db;
}

const MAX_TOKEN_LENGTH = 4096;

export function extractBearerToken(header: string | undefined): string {
  if (!header) throw AppError.unauthorized('Missing Authorization header');
  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header.trim());
  const token = match?.[1];
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw AppError.unauthorized('Authorization header must be "Bearer <token>"');
  }
  return token;
}

/**
 * 1. Read the bearer token.  2. Ask Supabase Auth to verify it.
 * 3. Load the caller's profile through the caller's own client (RLS applies).
 * 4. Reject inactive accounts.  The role comes from the database only.
 */
export function authenticate(gateway: SupabaseGateway | null): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!gateway) throw AppError.unavailable('Authentication is not configured on the server');
      const token = extractBearerToken(req.headers.authorization);

      const user = await gateway.verifyToken(token);
      if (!user) throw AppError.unauthorized('Invalid or expired token');

      const db = gateway.userClient(token);
      const profile = unwrap<ProfileRow>(
        await db.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle(),
      );
      if (!profile) throw AppError.forbidden('No profile exists for this account');
      if (!profile.is_active) throw AppError.forbidden('Your account has been deactivated');

      const ctx: AuthContext = {
        userId: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        role: profile.role,
        profile,
        db,
      };
      res.locals.auth = ctx;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Typed access to the authenticated caller inside a route handler. */
export function getAuth(res: Response): AuthContext {
  const ctx = res.locals.auth as AuthContext | undefined;
  if (!ctx) throw AppError.unauthorized();
  return ctx;
}
