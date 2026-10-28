import { describe, expect, it } from 'vitest';
import { firstRow, mapDbError, unwrap, unwrapRequired } from '../src/utils/dbError.js';
import { escapeLike, rangeFor } from '../src/utils/pagination.js';

describe('mapDbError', () => {
  it.each([
    ['CP401', 401, 'UNAUTHORIZED'],
    ['CP403', 403, 'FORBIDDEN'],
    ['CP404', 404, 'NOT_FOUND'],
    ['CP409', 409, 'CONFLICT'],
    ['CP422', 422, 'VALIDATION_ERROR'],
    ['42501', 403, 'FORBIDDEN'],
    ['23505', 409, 'CONFLICT'],
    ['23514', 422, 'VALIDATION_ERROR'],
    ['23503', 422, 'VALIDATION_ERROR'],
    ['22P02', 422, 'VALIDATION_ERROR'],
    ['PGRST116', 404, 'NOT_FOUND'],
    ['PGRST301', 401, 'UNAUTHORIZED'],
  ])('maps %s to %i %s', (code, status, appCode) => {
    const e = mapDbError({ code, message: 'whatever' });
    expect(e.statusCode).toBe(status);
    expect(e.code).toBe(appCode);
  });

  it('passes through the user-facing message of our own SQL functions', () => {
    expect(mapDbError({ code: 'CP409', message: 'invalid status change from submitted to resolved' }).message).toBe(
      'invalid status change from submitted to resolved',
    );
  });

  it('never leaks database internals for constraint or unknown errors', () => {
    const c = mapDbError({ code: '23505', message: 'duplicate key value violates unique constraint "categories_slug_key"' });
    expect(c.message).not.toContain('categories_slug_key');
    const u = mapDbError({ code: 'XX000', message: 'relation "secret_table" does not exist' });
    expect(u.statusCode).toBe(500);
    expect(u.message).not.toContain('secret_table');
  });

  it('maps a network failure to 503', () => {
    expect(mapDbError({ code: '', message: 'TypeError: fetch failed' }).statusCode).toBe(503);
  });
});

describe('unwrap helpers', () => {
  it('throws the mapped error', () => {
    expect(() => unwrap({ data: null, error: { code: 'CP403', message: 'no' } })).toThrowError(/no/);
  });
  it('unwrapRequired 404s on null data', () => {
    expect(() => unwrapRequired({ data: null, error: null })).toThrowError(/not found/i);
  });
  it('firstRow handles object, array and null', () => {
    expect(firstRow({ a: 1 })).toEqual({ a: 1 });
    expect(firstRow([{ a: 2 }])).toEqual({ a: 2 });
    expect(firstRow([])).toBeNull();
    expect(firstRow(null)).toBeNull();
  });
});

describe('pagination helpers', () => {
  it('computes inclusive ranges', () => {
    expect(rangeFor(1, 20)).toEqual([0, 19]);
    expect(rangeFor(3, 10)).toEqual([20, 29]);
  });
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
