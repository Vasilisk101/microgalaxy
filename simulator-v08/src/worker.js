let session = null;

self.onmessage = ({data}) => {
  try {
    let result;
    if (data.type === 'validate') {
      if (data.world?.id !== data.expectedId) throw new Error('Идентификатор мира не совпадает.');
      validateWorld(data.world);
      result = {id: data.world.id};
    } else {
      if (data.world) session = createWorkerSession(data.world);
      if (!session) throw new Error('Сеанс расчёта не открыт.');
      result = session.step(data.years, {stopOnImportant: data.stopOnImportant, watch:data.watch, freightId:data.freightId});
    }
    self.postMessage({id: data.id, result});
  } catch (error) {
    if (data.type !== 'validate') session = null;
    self.postMessage({id: data.id, error: error.message});
  }
};
self.postMessage({ready: true});
