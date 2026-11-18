// Shared across every model version. No fallback to a tab-local mutex: it would
// make deletion unsafe when another tab is active.
const GLOBAL_LOCK = 'microgalaxy:retention:global:v1';
const worldName = (model, id) => `microgalaxy:retention:world:v1:${JSON.stringify([model,id])}`;
function locks() {
  const manager = globalThis.navigator?.locks;
  if (!manager || typeof manager.request !== 'function') {
    const error = new Error('Безопасный общий учёт недоступен в этом браузере. Автоудаление отключено.');
    error.code = 'RETENTION_LOCK_UNAVAILABLE'; throw error;
  }
  return manager;
}
export async function withRetentionLock(operation) {
  return locks().request(GLOBAL_LOCK, {mode:'exclusive'}, operation);
}
/** Call inside withRetentionLock before reading the world; retain until the final write. */
export async function acquireWorldLease(model, id) {
  if (typeof model !== 'string' || !model || typeof id !== 'string' || !id) throw new TypeError('Invalid world identity');
  let acquired, release;
  const ready = new Promise((resolve, reject) => { acquired = {resolve,reject}; });
  const held = new Promise(resolve => { release = resolve; });
  const request = locks().request(worldName(model,id), {mode:'shared'}, async lock => {
    if (!lock) { acquired.reject(new Error('Не удалось защитить открытый мир.')); return; }
    acquired.resolve(); await held;
  });
  request.catch(error => acquired.reject(error));
  await ready;
  let closed=false;
  return async () => { if (!closed) { closed=true; release(); await request; } };
}
/** Must be called inside withRetentionLock; null means another tab holds the world. */
export async function withInactiveWorld(model,id,operation) {
  return locks().request(worldName(model,id), {mode:'exclusive', ifAvailable:true}, lock => lock ? operation() : null);
}
