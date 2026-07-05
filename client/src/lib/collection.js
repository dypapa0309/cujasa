export function patchById(rows, id, patch) {
  return rows.map((row) => row.id === id ? { ...row, ...patch } : row);
}

export function replaceById(rows, item) {
  if (!item?.id) return rows;
  return rows.map((row) => row.id === item.id ? item : row);
}

export function removeById(rows, id) {
  return rows.filter((row) => row.id !== id);
}

export function upsertById(rows, item) {
  if (!item?.id) return rows;
  return rows.some((row) => row.id === item.id)
    ? replaceById(rows, item)
    : [item, ...rows];
}
