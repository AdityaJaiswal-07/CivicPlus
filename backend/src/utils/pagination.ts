import { z } from 'zod';

export const paginationQuery = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

/** Query-string booleans: only the literal strings "true" / "false". */
export const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Inclusive row range for PostgREST `.range(from, to)`. */
export function rangeFor(page: number, limit: number): [number, number] {
  const from = (page - 1) * limit;
  return [from, from + limit - 1];
}

/** Escape LIKE wildcards so user text is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
