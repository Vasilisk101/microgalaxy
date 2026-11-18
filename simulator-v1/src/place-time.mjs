// Historical views and previews are detached from the owner's live world.
export function canVisit(live, year) {
  if (!Number.isSafeInteger(year) || year < 0 || year > live.year) return false;
  if (year === live.year) return true;
  const anchor = live.snapshots?.findLast(point => point.year <= year);
  if (!anchor) return false;
  if (anchor.year === year) return true;
  const fork = live.observatory?.experiment;
  return !fork || year < fork.year || anchor.observatory?.experiment?.pairId === fork.pairId;
}

export async function perform(core, recordsFor, input, pause) {
  const { task, regionId, year } = input;
  let state;
  if (task === 'example') {
    state = core.createWorld(input.seed, {era: 'industrial'});
  } else if (task === 'year') {
    if (!canVisit(input.world, year)) throw new Error('Для этой даты в архиве нет подтверждённого состояния места.');
    if (year === input.world.year) return {world:input.world};
    const index = input.world.snapshots.findLastIndex(point => point.year <= year);
    state = core.viewSnapshot(input.world, index);
  } else if (task === 'next') {
    state = input.world;
  } else {
    throw new Error('Неизвестное действие наблюдателя.');
  }
  const session = core.createWorkerSession(state);
  if (task === 'next') {
    const until = Math.min(state.year + 30, core.LIMITS.years);
    while (state.year < until) {
      session.step(1);
      if (recordsFor(state, regionId).some(record => record.year === state.year)) {
        return {world: state, found:true};
      }
      await pause();
    }
    return {world: state, found:false};
  }
  while (state.year < year) {
    session.step(Math.min(10, year - state.year));
    await pause();
  }
  return {world: state};
}
