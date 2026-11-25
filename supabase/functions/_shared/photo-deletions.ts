// Removes the files of deleted photo rows (customer removals, stale uploads, deleted enquiries:
// staff data requests and retention). Postgres queues the paths; only the storage API may delete
// the files. Run by the booking worker every minute; a failure stays queued with backoff.
import type { PhotoStore } from './storage.ts'
import type { Db } from './types.ts'

export async function processPhotoDeletions(
  db: Db,
  store: PhotoStore,
  limit = 50,
): Promise<{ removed: number; failed: number }> {
  const paths = await db.claimPhotoDeletions(limit)
  if (paths.length === 0) return { removed: 0, failed: 0 }
  try {
    await store.remove(paths)
    await db.photoDeletionDone(paths)
    return { removed: paths.length, failed: 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const path of paths) await db.photoDeletionFailed(path, message)
    return { removed: 0, failed: paths.length }
  }
}
