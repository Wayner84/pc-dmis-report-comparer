export async function fingerprintBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function cloneRowsForReport(rows, source) {
  return rows.map(row => ({ ...row, source }));
}

export function cacheParsedRows(cache, fingerprint, rows) {
  cache.set(fingerprint, rows.map(row => ({ ...row })));
}

export function getCachedRows(cache, fingerprint, source) {
  const rows = cache.get(fingerprint);
  return rows ? cloneRowsForReport(rows, source) : null;
}
