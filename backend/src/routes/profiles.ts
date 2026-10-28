import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../middleware/auth.js';
import { validate, validBody } from '../middleware/validate.js';
import { PROFILE_COLUMNS, toProfileDto, type ProfileRow } from '../types/domain.js';
import { unwrapRequired } from '../utils/dbError.js';
import { sendSuccess } from '../utils/response.js';

/** Empty string means "clear the field". Mirrors the CHECK constraints in the database. */
const clearable = (schema: z.ZodString) =>
  z
    .union([schema, z.literal('').transform(() => null), z.null()])
    .optional();

/** `.strict()` rejects unknown keys, so {"role":"admin"} is a 422, not silently ignored. */
export const updateProfileBody = z
  .object({
    fullName: clearable(z.string().trim().min(1).max(100)),
    phone: clearable(z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Phone must be 7-15 digits, optional leading +')),
    ward: clearable(z.string().trim().min(1).max(100)),
    avatarUrl: clearable(z.string().trim().max(500).url().startsWith('https://', 'Must be an https:// URL')),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

export function createProfilesRouter(): Router {
  const router = Router();

  router.get('/me', (_req, res) => {
    sendSuccess(res, toProfileDto(getAuth(res).profile));
  });

  router.patch('/me', validate({ body: updateProfileBody }), async (_req, res) => {
    const a = getAuth(res);
    const body = validBody<z.infer<typeof updateProfileBody>>(res);

    const patch: Record<string, string | null> = {};
    if (body.fullName !== undefined) patch.full_name = body.fullName;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.ward !== undefined) patch.ward = body.ward;
    if (body.avatarUrl !== undefined) patch.avatar_url = body.avatarUrl;

    // Only whitelisted columns are ever sent; the DB also refuses role/is_active changes.
    const row = unwrapRequired<ProfileRow>(
      await a.db.from('profiles').update(patch).eq('id', a.userId).select(PROFILE_COLUMNS).single(),
    );
    sendSuccess(res, toProfileDto(row));
  });

  return router;
}
