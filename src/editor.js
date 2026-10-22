const EDITABLE_FIELDS = new Set(['feature', 'axis']);

export function updateEditableText(rows, rowIndex, field, value) {
  if (!Array.isArray(rows) || !Number.isInteger(rowIndex) || !rows[rowIndex] || !EDITABLE_FIELDS.has(field)) return false;
  const cleaned = String(value).trim();
  if (!cleaned) return false;
  rows[rowIndex][field] = cleaned;
  return true;
}
