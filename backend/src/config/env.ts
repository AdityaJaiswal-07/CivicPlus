import { z } from 'zod';

function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:5173')
      .transform(parseOrigins)
      .superRefine((origins, ctx) => {
        if (origins.length === 0) {
          ctx.addIssue({ code: 'custom', message: 'At least one origin is required' });
        }
        for (const origin of origins) {
          let ok = false;
          try {
            const u = new URL(origin);
            ok = (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === origin;
          } catch {
            ok = false;
          }
          if (!ok) {
            ctx.addIssue({
              code: 'custom',
              message: 'Each origin must be like https://example.com (no path, no trailing slash, no wildcard)',
            });
            break;
          }
        }
      }),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    /** Extra, lower limit for state-changing requests (POST/PATCH/PUT/DELETE) per IP per window. */
    WRITE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    SUPABASE_URL: optionalString.refine(
      (v) => {
        if (v === undefined) return true;
        try {
          const u = new URL(v);
          return u.protocol === 'https:' || u.protocol === 'http:';
        } catch {
          return false;
        }
      },
      { message: 'Must be a valid URL' },
    ),
    SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    STORAGE_BUCKET: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{2,62}$/, 'Must be a valid bucket id')
      .default('report-photos'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      // Production browsers must reach the API over HTTPS (localhost stays allowed for local prod-mode runs).
      const insecure = env.ALLOWED_ORIGINS.some((o) => {
        const u = new URL(o);
        return u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1';
      });
      if (insecure) {
        ctx.addIssue({ code: 'custom', path: ['ALLOWED_ORIGINS'], message: 'In production, non-localhost origins must use https://' });
      }
      for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required when NODE_ENV=production',
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validate environment variables. Error messages list only variable names and
 * reasons, never the values, so secrets cannot leak into logs.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
