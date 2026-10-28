import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('applies safe defaults without any Supabase credentials in development', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:5173']);
    expect(env.SUPABASE_URL).toBeUndefined();
  });

  it('parses a comma-separated origin list', () => {
    const env = loadEnv({ ALLOWED_ORIGINS: 'http://localhost:3000, https://app.example.com' });
    expect(env.ALLOWED_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('rejects wildcard origins', () => {
    expect(() => loadEnv({ ALLOWED_ORIGINS: '*' })).toThrow(/ALLOWED_ORIGINS/);
  });

  it('rejects origins with a trailing slash or path', () => {
    expect(() => loadEnv({ ALLOWED_ORIGINS: 'https://app.example.com/' })).toThrow(/ALLOWED_ORIGINS/);
    expect(() => loadEnv({ ALLOWED_ORIGINS: 'https://app.example.com/app' })).toThrow(/ALLOWED_ORIGINS/);
  });

  it('rejects an invalid PORT', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('requires Supabase settings in production', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('accepts a complete production config', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    });
    expect(env.NODE_ENV).toBe('production');
  });

  it('never includes secret values in error messages', () => {
    try {
      loadEnv({ SUPABASE_URL: 'not-a-url', SUPABASE_SERVICE_ROLE_KEY: 'super-secret-value', PORT: 'abc' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret-value');
    }
  });

  it('defaults the write rate limit and validates it', () => {
    expect(loadEnv({}).WRITE_RATE_LIMIT_MAX).toBe(120);
    expect(() => loadEnv({ WRITE_RATE_LIMIT_MAX: '0' })).toThrow(/WRITE_RATE_LIMIT_MAX/);
  });

  it('defaults the storage bucket and rejects a bad bucket id', () => {
    expect(loadEnv({}).STORAGE_BUCKET).toBe('report-photos');
    expect(() => loadEnv({ STORAGE_BUCKET: 'Bad Bucket!' })).toThrow(/STORAGE_BUCKET/);
  });

  it('in production requires https for non-localhost origins', () => {
    const base = { NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's' };
    expect(() => loadEnv({ ...base, ALLOWED_ORIGINS: 'http://app.example.com' })).toThrow(/ALLOWED_ORIGINS/);
    expect(loadEnv({ ...base, ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:5173' }).ALLOWED_ORIGINS).toHaveLength(2);
    // development is unaffected
    expect(loadEnv({ ALLOWED_ORIGINS: 'http://app.example.com' }).ALLOWED_ORIGINS).toEqual(['http://app.example.com']);
  });
});
