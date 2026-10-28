import { createApp } from '../src/app.js';
import { loadEnv, type Env } from '../src/config/env.js';

export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    RATE_LIMIT_MAX: '1000',
    ...overrides,
  });
}

export function testApp(overrides: Record<string, string | undefined> = {}) {
  return createApp(testEnv(overrides));
}
