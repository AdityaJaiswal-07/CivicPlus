import { randomUUID } from 'node:crypto';
import type { SupabaseGateway } from '../config/supabase.js';
import { AppError } from '../utils/AppError.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
export type PhotoType = keyof typeof PHOTO_TYPES;
const SIGNED_URL_SECONDS = 3600;

export interface PhotoView {
  path: string;
  url: string | null;
}

/**
 * Photo storage on top of the PRIVATE bucket. All calls use the service-role client, so callers
 * must have already proven (through the user's own RLS-scoped query) that the user may touch
 * the report/paths involved.
 */
export function createPhotoService(gateway: SupabaseGateway | null, bucket: string) {
  const storage = () => {
    if (!gateway) throw AppError.unavailable('Photo storage is not configured on the server');
    return gateway.adminClient().storage.from(bucket);
  };

  return {
    /** Server picks the path: `<userId>/<uuid>.<ext>`. The client can never choose where it writes. */
    async createUploadUrl(userId: string, contentType: PhotoType) {
      const path = `${userId}/${randomUUID()}.${PHOTO_TYPES[contentType]}`;
      const { data, error } = await storage().createSignedUploadUrl(path);
      if (error || !data) throw AppError.unavailable('Could not prepare the upload, please try again');
      return {
        path,
        uploadUrl: data.signedUrl as string,
        token: data.token as string,
        method: 'PUT',
        contentType,
        maxBytes: MAX_PHOTO_BYTES,
        expiresInSeconds: 7200,
      };
    },

    /** Every path must already exist in the caller's own folder. */
    async assertExist(userId: string, paths: string[]): Promise<void> {
      if (paths.length === 0) return;
      const s = storage();
      for (const p of paths) {
        const [folder, file] = p.split('/');
        if (!folder || !file || folder.toLowerCase() !== userId.toLowerCase()) {
          throw new AppError(422, 'VALIDATION_ERROR', 'Invalid photo path', [{ path: 'photoPaths', message: 'Invalid photo path' }]);
        }
        const { data, error } = await s.list(folder, { search: file, limit: 10 });
        if (error) throw AppError.unavailable('Could not verify the uploaded photos, please try again');
        if (!(data ?? []).some((o: { name: string }) => o.name === file)) {
          throw new AppError(422, 'VALIDATION_ERROR', 'A photo was not uploaded yet', [
            { path: 'photoPaths', message: `Upload not found: ${p}` },
          ]);
        }
      }
    },

    /** Short-lived read URLs. Never throws: a storage hiccup must not break the report view. */
    async signUrls(paths: string[]): Promise<PhotoView[]> {
      if (paths.length === 0) return [];
      try {
        const { data, error } = await storage().createSignedUrls(paths, SIGNED_URL_SECONDS);
        if (error || !data) return paths.map((path) => ({ path, url: null }));
        const byPath = new Map<string, string | null>(
          data.map((d: { path: string | null; signedUrl: string | null; error: string | null }) => [d.path ?? '', d.error ? null : d.signedUrl]),
        );
        return paths.map((path) => ({ path, url: byPath.get(path) ?? null }));
      } catch {
        return paths.map((path) => ({ path, url: null }));
      }
    },

    /** Best effort clean-up of files no longer referenced. Failures are ignored (orphans are harmless: private). */
    async remove(paths: string[]): Promise<void> {
      if (paths.length === 0) return;
      try {
        await storage().remove(paths);
      } catch {
        /* ignore */
      }
    },
  };
}

export type PhotoService = ReturnType<typeof createPhotoService>;
