import type { Db, SupabaseGateway, VerifiedUser } from '../../src/config/supabase.js';
import type { ProfileRow, Role } from '../../src/types/domain.js';
import { AppError } from '../../src/utils/AppError.js';

/** One chained PostgREST call, e.g. from('reports').select(..).eq(..).single() */
export interface Call {
  kind: 'from' | 'rpc';
  name: string;
  ops: Array<{ op: string; args: unknown[] }>;
  rpcArgs?: unknown;
  /** Token of the user whose client made the call, or 'service-role'. */
  as: string;
}

export interface FakeResult {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
}

export const opArgs = (c: Call, op: string): unknown[] | undefined => c.ops.find((o) => o.op === op)?.args;
export const hasOp = (c: Call, op: string, ...args: unknown[]): boolean =>
  c.ops.some((o) => o.op === op && args.every((a, i) => JSON.stringify(o.args[i]) === JSON.stringify(a)));

/** Valid RFC-4122 v4-shaped UUIDs (Zod's uuid() is strict about version/variant). */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function chain(call: Call, respond: (c: Call) => FakeResult | Promise<FakeResult>): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(respond(call)).then(
              (r) => resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }),
              reject,
            );
        }
        if (typeof prop === 'symbol') return undefined;
        return (...args: unknown[]) => {
          call.ops.push({ op: prop, args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

export type Handler = (call: Call, who: Actor | null) => FakeResult | Promise<FakeResult> | undefined;

export interface Actor {
  token: string;
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  emailVerified: boolean;
  hasProfile: boolean;
}

/**
 * An in-memory stand-in for Supabase: tokens -> users, each user's client answers
 * the auth middleware's profile lookup, everything else goes to handlers the test registers.
 * No network, no credentials.
 */
export function makeWorld() {
  const actors = new Map<string, Actor>();
  const handlers: Handler[] = [];
  const calls: Call[] = [];
  const adminEmails = new Map<string, string>();
  const files = new Set<string>();
  const storageCalls: Array<{ op: string; bucket: string; as: string; args: unknown[] }> = [];
  let nextId = 1000;
  let adminConfigured = true;

  const profileOf = (a: Actor): ProfileRow => ({
    id: a.id,
    full_name: `User ${a.role}`,
    phone: null,
    ward: null,
    avatar_url: null,
    role: a.role,
    is_active: a.isActive,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });

  function respondFor(token: string) {
    return async (call: Call): Promise<FakeResult> => {
      const who = actors.get(token) ?? null;
      if (call.kind === 'from' && call.name === 'profiles' && who && hasOp(call, 'maybeSingle') && hasOp(call, 'eq', 'id', who.id)) {
        return { data: who.hasProfile ? profileOf(who) : null };
      }
      for (const h of handlers) {
        const r = await h(call, who);
        if (r) return r;
      }
      return { error: { code: 'TEST_UNHANDLED', message: `unhandled ${call.kind} ${call.name}` } };
    };
  }

  function makeDb(token: string): Db {
    const respond = respondFor(token);
    const db = {
      from: (name: string) => {
        const call: Call = { kind: 'from', name, ops: [], as: token };
        calls.push(call);
        return chain(call, respond);
      },
      rpc: (name: string, rpcArgs?: unknown) => {
        const call: Call = { kind: 'rpc', name, ops: [], rpcArgs, as: token };
        calls.push(call);
        return chain(call, respond);
      },
      storage: {
        from: (bucket: string) => {
          const rec = (op: string, ...args: unknown[]) => storageCalls.push({ op, bucket, as: token, args });
          return {
            createSignedUploadUrl: async (path: string) => {
              rec('createSignedUploadUrl', path);
              return { data: { signedUrl: `https://storage.test/upload/${bucket}/${path}?token=t`, token: 't', path }, error: null };
            },
            list: async (folder: string, opts?: { search?: string }) => {
              rec('list', folder, opts);
              const names = [...files].filter((f) => f.startsWith(`${folder}/`)).map((f) => ({ name: f.slice(folder.length + 1) }));
              return { data: names.filter((n) => !opts?.search || n.name.includes(opts.search)), error: null };
            },
            createSignedUrls: async (paths: string[], expiresIn: number) => {
              rec('createSignedUrls', paths, expiresIn);
              return { data: paths.map((p) => ({ path: p, signedUrl: `https://storage.test/sign/${bucket}/${p}?exp=${expiresIn}`, error: null })), error: null };
            },
            remove: async (paths: string[]) => {
              rec('remove', paths);
              paths.forEach((p) => files.delete(p));
              return { data: [], error: null };
            },
          };
        },
      },
      auth: {
        admin: {
          getUserById: async (id: string) => ({ data: { user: { id, email: adminEmails.get(id) ?? null } }, error: null }),
        },
      },
    };
    return db as unknown as Db;
  }

  const gateway: SupabaseGateway = {
    async verifyToken(token): Promise<VerifiedUser | null> {
      const a = actors.get(token);
      return a ? { id: a.id, email: a.email, emailVerified: a.emailVerified } : null;
    },
    userClient: (token) => makeDb(token),
    adminClient: () => {
      if (!adminConfigured) throw AppError.unavailable('This operation is not configured on the server');
      return makeDb('service-role');
    },
  };

  return {
    gateway,
    calls,
    files,
    storageCalls,
    addActor(role: Role, overrides: Partial<Actor> = {}): Actor {
      nextId += 1;
      const a: Actor = {
        token: `token-${role}-${nextId}`,
        id: uuid(nextId),
        email: `${role}${nextId}@example.test`,
        role,
        isActive: true,
        emailVerified: true,
        hasProfile: true,
        ...overrides,
      };
      actors.set(a.token, a);
      return a;
    },
    bearer: (a: Actor) => `Bearer ${a.token}`,
    onCall(h: Handler) {
      handlers.push(h);
    },
    setAdminEmail(id: string, email: string) {
      adminEmails.set(id, email);
    },
    disableAdminClient() {
      adminConfigured = false;
    },
    profileOf,
    /** Calls that reached the database after the auth middleware's own profile lookup. */
    dataCalls: () => calls.filter((c) => !(c.kind === 'from' && c.name === 'profiles' && hasOp(c, 'maybeSingle'))),
  };
}
