/** Pure planning only: deleting a candidate additionally requires a live lease,
 * owner-scoped revision/pointer CAS, and a durable tombstone. */
export const MIB = 1024 * 1024;
export const DEFAULT_LIMIT_BYTES = 200 * MIB;
export const LIMIT_OPTIONS_BYTES = Object.freeze([50, 100, 200, 500].map(n => n * MIB));

/** The confirmation describes the exact revisions displayed when lowering a limit. */
export async function retentionConfirmation(records, previousLimit, nextLimit) {
  const {remove} = planRetention(records,nextLimit);
  const data = JSON.stringify([previousLimit,nextLimit,remove.map(r=>[r.model,r.id,r.revision,r.bytes])]);
  const hash = await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function planRetention(records, limitBytes = DEFAULT_LIMIT_BYTES) {
  if (!LIMIT_OPTIONS_BYTES.includes(limitBytes)) throw new RangeError('Invalid retention limit');
  const ids = new Set(); let knownBytes = 0, unknownCount = 0;
  for (const row of records) {
    const identity = JSON.stringify([row.model, row.id]);
    if (typeof row.model !== 'string' || !row.model || typeof row.id !== 'string' || !row.id || ids.has(identity)) throw new TypeError('Invalid or duplicate world identity');
    ids.add(identity);
    if (row.bytes === null || row.bytes === undefined) { unknownCount++; continue; }
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || !Number.isSafeInteger(knownBytes + row.bytes)) throw new RangeError('Invalid storage size');
    knownBytes += row.bytes;
  }
  let remainingBytes = knownBytes;
  const candidates = records.filter(r => Number.isSafeInteger(r.bytes) && r.bytes >= 0 && !r.active && !r.pinned && !r.pending && !r.legacyProtected && typeof r.updatedAt === 'string' && Number.isFinite(Date.parse(r.updatedAt)))
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const remove = [];
  for (const row of candidates) {
    if (remainingBytes <= limitBytes) break;
    remainingBytes -= row.bytes; remove.push({model: row.model, id: row.id, revision: row.revision, bytes: row.bytes});
  }
  return {limitBytes, knownBytes, unknownCount, remove, remainingBytes,
    blocked: remainingBytes > limitBytes, complete: unknownCount === 0};
}
