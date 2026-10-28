import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate, validBody, validParams, validQuery } from '../middleware/validate.js';
import { CATEGORY_COLUMNS, toCategoryDto, type CategoryRow } from '../types/domain.js';
import { unwrap, unwrapRequired } from '../utils/dbError.js';
import { queryBoolean } from '../utils/pagination.js';
import { sendSuccess } from '../utils/response.js';

const listQuery = z.object({ includeInactive: queryBoolean.default(false) });
const idParams = z.object({ id: z.uuid() });

const slug = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');
const name = z.string().trim().min(2).max(80);
const description = z.union([z.string().trim().max(300), z.null()]);

export const createCategoryBody = z
  .object({
    slug,
    name,
    description: description.optional(),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export const updateCategoryBody = z
  .object({
    slug: slug.optional(),
    name: name.optional(),
    description: description.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

export function createCategoriesRouter(): Router {
  const router = Router();

  // Everyone signed in can read. Pickers use active ones; old reports may need inactive names.
  router.get('/', validate({ query: listQuery }), async (_req, res) => {
    const a = getAuth(res);
    const { includeInactive } = validQuery<z.infer<typeof listQuery>>(res);
    let q = a.db.from('categories').select(CATEGORY_COLUMNS);
    if (!includeInactive) q = q.eq('is_active', true);
    const rows = unwrap<CategoryRow[]>(await q.order('sort_order', { ascending: true }).order('name', { ascending: true }));
    sendSuccess(res, (rows ?? []).map(toCategoryDto));
  });

  router.post('/', requireRole('admin'), validate({ body: createCategoryBody }), async (_req, res) => {
    const a = getAuth(res);
    const b = validBody<z.infer<typeof createCategoryBody>>(res);
    const row = unwrapRequired<CategoryRow>(
      await a.db
        .from('categories')
        .insert({ slug: b.slug, name: b.name, description: b.description ?? null, sort_order: b.sortOrder })
        .select(CATEGORY_COLUMNS)
        .single(),
    );
    sendSuccess(res, toCategoryDto(row), { status: 201 });
  });

  router.patch('/:id', requireRole('admin'), validate({ params: idParams, body: updateCategoryBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof updateCategoryBody>>(res);
    const patch: Record<string, unknown> = {};
    if (b.slug !== undefined) patch.slug = b.slug;
    if (b.name !== undefined) patch.name = b.name;
    if (b.description !== undefined) patch.description = b.description;
    if (b.sortOrder !== undefined) patch.sort_order = b.sortOrder;
    if (b.isActive !== undefined) patch.is_active = b.isActive;
    // .single() on an UPDATE that matched nothing yields PGRST116 -> 404.
    const row = unwrapRequired<CategoryRow>(
      await a.db.from('categories').update(patch).eq('id', id).select(CATEGORY_COLUMNS).single(),
    );
    sendSuccess(res, toCategoryDto(row));
  });

  return router;
}
