/** Where an item sits in a walked list: "3 of 8", and its neighbours (null at the ends). */
export function neighbours(ids: string[], id: string) {
  const index = ids.indexOf(id)
  if (index < 0) return null
  return {
    position: index + 1,
    total: ids.length,
    previous: ids[index - 1] ?? null,
    next: ids[index + 1] ?? null,
  }
}
