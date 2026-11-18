import { advanceWorldBatch, MAX_ADVANCE_BATCH, type World } from './simulation';
let world: World | null = null;
self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === 'load') { world = message.world; self.postMessage({ type: 'ready', id: message.id }); return; }
    if (message.type !== 'advance' || !world) return;
    const steps = Math.min(MAX_ADVANCE_BATCH, Math.max(1, Math.floor(message.years || 1)));
    const result = advanceWorldBatch(world, steps, {
      untilEvent: !!message.untilEvent,
      autoPause: !!message.autoPause,
    });
    world = result.world;
    self.postMessage({ type: 'state', id: message.id, ...result });
  } catch (error) { self.postMessage({ type: 'error', id: message.id, error: error instanceof Error ? error.message : 'Не удалось рассчитать следующий шаг' }); }
};
