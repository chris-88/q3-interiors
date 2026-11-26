import { useState } from 'react'

/**
 * The moment a query's data was loaded (or this screen opened, before it was): ages and
 * "upcoming" are judged against it, so the same data always shows and sorts the same way.
 */
export function useLoadedAt(dataUpdatedAt: number): number {
  const [opened] = useState(() => Date.now())
  return dataUpdatedAt || opened
}
