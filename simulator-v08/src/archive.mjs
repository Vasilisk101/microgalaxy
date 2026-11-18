/**
 * MICROGALAXY 0.5 append-only history containers. No model or browser imports.
 *
 * Events: complete, immutable 256-record pages plus a tail of at most 256.
 * Missions: completed 128-record pages (the final page may be partial) plus
 * active transit records. No lifetime event/mission count is silently trimmed.
 * Persistence still has an explicit 24 MiB file/body budget; paging is not a
 * promise of unlimited storage and must never bypass the storage-layer limit.
 *
 * Pure readers return new arrays with read-only, structurally shared records.
 * They never freeze or otherwise mutate their input. A detached historical
 * model is made by the caller cloning once after applying archiveThroughYear.
 */
export const EVENT_PAGE_SIZE = 256;
export const MISSION_PAGE_SIZE = 128;
export const SNAPSHOT_LIMIT = 64;
export const RECENT_SNAPSHOTS = 16;
// An index is reusable only for the exact, deeply frozen page container created
// by a successful archival operation. JSON/structuredClone/new arrays miss it.
const missionIndexes = new WeakMap();

function fail(message) { throw new Error('Некорректный архив: ' + message); }
function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(label);
  return value;
}
function array(value, label) {
  if (!Array.isArray(value)) fail(label);
  return value;
}
function worldYear(w) { return integer(w?.year, 'год мира'); }
function cutoff(w, throughYear) {
  if (throughYear !== Infinity) integer(throughYear, 'год среза');
  return Math.min(worldYear(w), throughYear);
}
function eventContainers(w) {
  return [array(w?.eventArchive, 'страницы событий'), array(w?.events, 'хвост событий')];
}
function missionContainers(w) {
  return [array(w?.missionArchive, 'страницы полётов'), array(w?.missions, 'активные полёты')];
}
function physicalEventCount(w) {
  const [pages, tail] = eventContainers(w);
  if (tail.length > EVENT_PAGE_SIZE) fail('размер хвоста событий');
  const count = pages.length * EVENT_PAGE_SIZE + tail.length;
  return integer(count, 'число событий');
}
function rawEventAt(w, index) {
  const [pages, tail] = eventContainers(w);
  if (!Number.isSafeInteger(index) || index < 0) return null;
  const page = Math.floor(index / EVENT_PAGE_SIZE), offset = index % EVENT_PAGE_SIZE;
  return (page < pages.length ? pages[page]?.[offset] : page === pages.length ? tail[offset] : null) ?? null;
}
function eventNumber(id) {
  if (typeof id !== 'string' || !/^e[1-9][0-9]*$/.test(id)) return null;
  const n = Number(id.slice(1));
  return Number.isSafeInteger(n) ? n : null;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
function immutableCopy(record) {
  return deepFreeze(structuredClone(record));
}

/** Read-only preview; appendEvent is the only allocator. */
export function nextEventId(w) {
  const count = physicalEventCount(w), next = integer(w?.nextEvent, 'счётчик событий', 1);
  if (next !== count + 1 || next >= Number.MAX_SAFE_INTEGER) fail('непрерывность счётчика событий');
  return 'e' + next;
}

/** Append atomically with a global eN identity. Neither payload nor old pages change. */
export function appendEvent(w, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('новое событие');
  const id = nextEventId(w), year = payload.year ?? worldYear(w), last = rawEventAt(w, w.nextEvent - 2);
  integer(year, 'год события');
  if (year > worldYear(w) || (last && year < last.year)) fail('порядок событий');
  if (payload.id !== undefined && payload.id !== id) fail('идентификатор нового события');
  const causes = payload.causeEventIds ?? [];
  if (!Array.isArray(causes) || new Set(causes).size !== causes.length) fail('причинные ссылки');
  for (const cause of causes) {
    const n = eventNumber(cause), previous = n === null ? null : rawEventAt(w, n - 1);
    if (!previous || previous.id !== cause || n >= w.nextEvent || previous.year > year) fail('причина отсутствует или находится в будущем');
  }
  // Clone/freeze before touching any world field: an unserialisable payload does
  // not consume an identity or leave half a page installed.
  const record = immutableCopy({...payload, id, year, causeEventIds: causes});
  const [pages, tail] = eventContainers(w);
  if (tail.length === EVENT_PAGE_SIZE) {
    w.eventArchive = [...pages, Object.freeze(tail.map(immutableCopy))];
    w.events = [record];
  } else {
    w.events = [...tail, record];
  }
  w.nextEvent += 1;
  return record;
}

/** Borrowed read-only records, chronological; whole out-of-range pages are skipped. */
export function* iterateEvents(w, {afterYear = -1, throughYear = Infinity} = {}) {
  integer(afterYear, 'начальный год', -1);
  const end = cutoff(w, throughYear), [pages, tail] = eventContainers(w);
  if (end <= afterYear) return;
  for (let p = 0; p <= pages.length; p++) {
    const page = p === pages.length ? tail : pages[p];
    if (!page?.length) continue;
    if (page[0].year > end) return;
    if (page.at(-1).year <= afterYear) continue;
    for (const e of page) {
      if (e.year > end) return;
      if (e.year > afterYear) yield e;
    }
  }
}
export function allEvents(w, throughYear = Infinity) {
  return Array.from(iterateEvents(w, {throughYear}));
}
/** Exclusive lower year, inclusive upper year. For a count cursor use eventsAfter. */
export function eventsSince(w, afterYear, throughYear = Infinity) {
  return Array.from(iterateEvents(w, {afterYear, throughYear}));
}
/** Events after a count cursor; unlike a year filter this includes same-year records. */
export function eventsAfter(w, count, throughYear = Infinity) {
  integer(count, 'курсор событий');
  const total = physicalEventCount(w), end = cutoff(w, throughYear), result = [];
  if (count > total) fail('курсор за концом архива');
  for (let i = count; i < total; i++) {
    const e = rawEventAt(w, i);
    if (e.year > end) break;
    result.push(e);
  }
  return result;
}
export function eventCount(w, throughYear = Infinity) {
  const end = cutoff(w, throughYear), total = physicalEventCount(w);
  // Upper bound by year: O(log N), including cutoffs within a closed page.
  let low = 0, high = total;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (rawEventAt(w, middle).year <= end) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function eventPageCount(w, throughYear = Infinity) {
  return Math.ceil(eventCount(w, throughYear) / EVENT_PAGE_SIZE);
}
/** Physical zero-based page, not an offset; never flattens other pages. */
export function eventPage(w, pageIndex, {throughYear = Infinity} = {}) {
  integer(pageIndex, 'номер страницы');
  const end = cutoff(w, throughYear), [pages, tail] = eventContainers(w);
  const page = pageIndex < pages.length ? pages[pageIndex] : pageIndex === pages.length ? tail : [];
  return page.filter(e => e.year <= end);
}
export function eventById(w, id, throughYear = Infinity) {
  const n = eventNumber(id), end = cutoff(w, throughYear);
  if (n === null) return null;
  const e = rawEventAt(w, n - 1);
  return e?.id === id && e.year <= end ? e : null;
}

function completionYear(m) { return m.completedAt ?? m.arrival; }
function missionDates(m, year, archived) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id) fail('полёт');
  integer(m.departure, 'год отправления');integer(m.arrival, 'год прибытия');
  if (m.arrival <= m.departure || m.departure > year) fail('время полёта');
  if (archived) {
    if (m.status !== 'arrived') fail('незавершённый полёт в архиве');
    integer(completionYear(m), 'год завершения полёта');
    // This model has no overdue-flight state. A second completion date must not
    // create a historical transit record whose scheduled arrival is in the past.
    if (completionYear(m) !== m.arrival || completionYear(m) > year) fail('время завершения полёта');
  } else if (m.status !== 'transit' || m.arrival <= year) fail('завершённый полёт в активном списке');
}
function missionOrder(a, b) {
  const difference = a.departure - b.departure;
  if (difference) return difference;
  // IDs use the global entity counter, but unknown future ID formats still sort
  // deterministically without locale/environment-dependent comparisons.
  const na = /^m[1-9][0-9]*$/.test(a.id) ? Number(a.id.slice(1)) : NaN;
  const nb = /^m[1-9][0-9]*$/.test(b.id) ? Number(b.id.slice(1)) : NaN;
  return Number.isSafeInteger(na) && Number.isSafeInteger(nb) ? na - nb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/**
 * All launched missions as known at the cutoff. A mission whose completion is
 * later is shown in transit, not as a future success. Its scheduled arrival is
 * retained (it was already known on departure). No later departure is returned.
 */
export function allMissions(w, throughYear = Infinity) {
  const end = cutoff(w, throughYear), [pages, active] = missionContainers(w), result = [];
  const include = m => {
    if (m.departure > end) return;
    if (m.status !== 'transit' && completionYear(m) > end) {
      const past = {...m, status: 'transit'};
      delete past.completedAt;
      result.push(past);
    } else result.push(m);
  };
  for (const page of pages) for (const m of page) include(m);
  for (const m of active) include(m);
  return result.sort(missionOrder);
}
export function missionCount(w, throughYear = Infinity) {
  return allMissions(w, throughYear).length;
}
/** Move completed records out of active slots. Full existing pages stay identical. */
export function archiveCompletedMissions(w) {
  const year = worldYear(w), [pages, missions] = missionContainers(w);
  const completed = missions.filter(m => m.status !== 'transit');
  if (!completed.length) return 0;
  const active = missions.filter(m => m.status === 'transit'), cached = missionIndexes.get(w);
  const trusted = cached?.pages === pages && cached.year <= year, ids = trusted ? cached.ids : new Set();
  if (!trusted) {
    for (let p = 0; p < pages.length; p++) {
      const page = array(pages[p], 'страница полётов');
      if (!page.length || page.length > MISSION_PAGE_SIZE || (p < pages.length - 1 && page.length !== MISSION_PAGE_SIZE)) fail('размер страницы полётов');
      for (const m of page) {
        missionDates(m, year, true);
        if (ids.has(m.id)) fail('повтор полёта');
        ids.add(m.id);
      }
    }
  }
  const currentIds = new Set();
  for (const m of missions) {
    missionDates(m, year, m.status !== 'transit');
    if (ids.has(m.id) || currentIds.has(m.id)) fail('повтор полёта');
    currentIds.add(m.id);
  }
  const next = pages.slice(), copies = completed.map(immutableCopy);
  let offset = 0;
  if (next.length && next.at(-1).length < MISSION_PAGE_SIZE) {
    const last = next.pop(), take = Math.min(MISSION_PAGE_SIZE - last.length, copies.length);
    next.push(Object.freeze([...last, ...copies.slice(0, take)]));
    offset = take;
  }
  for (; offset < copies.length; offset += MISSION_PAGE_SIZE) next.push(Object.freeze(copies.slice(offset, offset + MISSION_PAGE_SIZE)));
  // Only successful operations freeze previously deserialised pages. Once the
  // immutable container is installed, future completions need no full rescan.
  if (!trusted) for (const page of pages) deepFreeze(page);
  w.missionArchive = Object.freeze(next);
  w.missions = active;
  for (const m of completed) ids.add(m.id);
  missionIndexes.set(w, {pages: w.missionArchive, ids, year});
  return completed.length;
}

/** Four archive fields only; apply AFTER spreading root/snapshot, then clone once. */
export function archiveThroughYear(w, year) {
  const end = cutoff(w, year), [pages, tail] = eventContainers(w), eventArchive = [];
  let events = [], finished = false;
  for (const page of pages) {
    if (page.at(-1).year <= end) eventArchive.push(page);
    else {events = page.filter(e => e.year <= end);finished = true;break;}
  }
  if (!finished) events = tail.filter(e => e.year <= end);
  const visible = allMissions(w, end), missions = visible.filter(m => m.status === 'transit');
  const completed = visible.filter(m => m.status !== 'transit'), missionArchive = [];
  for (let i = 0; i < completed.length; i += MISSION_PAGE_SIZE) missionArchive.push(completed.slice(i, i + MISSION_PAGE_SIZE));
  return {eventArchive, events, missionArchive, missions};
}

/** Shape/identity/date validation; model-specific actors and event DAG are Core's job. */
export function validateArchive(w) {
  const year = worldYear(w), [eventPages, tail] = eventContainers(w), [missionPages, active] = missionContainers(w);
  if (tail.length > EVENT_PAGE_SIZE) fail('размер хвоста событий');
  let number = 1, previousYear = -1;
  const checkEvent = e => {
    if (!e || typeof e !== 'object' || e.id !== 'e' + number) fail('непрерывность идентификаторов событий');
    integer(e.year, 'год события');
    if (e.year < previousYear || e.year > year) fail('порядок событий');
    previousYear = e.year;number += 1;
  };
  for (const page of eventPages) {
    if (!Array.isArray(page) || page.length !== EVENT_PAGE_SIZE) fail('размер закрытой страницы событий');
    for (const e of page) checkEvent(e);
  }
  for (const e of tail) checkEvent(e);
  if (w.nextEvent !== number || !Number.isSafeInteger(w.nextEvent)) fail('счётчик событий');
  const ids = new Set(), checkMission = (m, archived) => {
    missionDates(m, year, archived);
    if (ids.has(m.id)) fail('повтор полёта');
    ids.add(m.id);
  };
  for (let p = 0; p < missionPages.length; p++) {
    const page = missionPages[p];
    if (!Array.isArray(page) || !page.length || page.length > MISSION_PAGE_SIZE || (p < missionPages.length - 1 && page.length !== MISSION_PAGE_SIZE)) fail('размер страницы полётов');
    for (const m of page) checkMission(m, true);
  }
  for (const m of active) checkMission(m, false);
  return true;
}

/**
 * Preserve origin + latest 16 checkpoints. Older anchors are removed one at a
 * time at the smallest enclosing interval; equal densities remove the oldest
 * candidate first. This keeps deterministic coverage across the whole past.
 */
export function retainSnapshots(snapshots, {limit = SNAPSHOT_LIMIT, recent = RECENT_SNAPSHOTS} = {}) {
  array(snapshots, 'контрольные точки');integer(limit, 'лимит контрольных точек', 2);integer(recent, 'недавние контрольные точки', 1);
  if (recent >= limit) fail('нет места для исходной контрольной точки');
  let previous = -1;
  for (const s of snapshots) {
    integer(s?.year, 'год контрольной точки');
    if (s.year <= previous) fail('порядок контрольных точек');
    previous = s.year;
  }
  if (snapshots.length && snapshots[0].year !== 0) fail('нет исходной контрольной точки');
  const kept = snapshots.slice();
  while (kept.length > limit) {
    let remove = 1, smallest = Infinity;
    for (let i = 1; i < kept.length - recent; i++) {
      const span = kept[i + 1].year - kept[i - 1].year;
      if (span < smallest) {smallest = span;remove = i;}
    }
    kept.splice(remove, 1);
  }
  return kept;
}
export function snapshotCoverage(snapshots) {
  const kept = retainSnapshots(snapshots), years = kept.map(s => s.year), recent = years.slice(-RECENT_SNAPSHOTS);
  return {count: years.length, oldestYear: years[0] ?? null, newestYear: years.at(-1) ?? null,
    recentFromYear: recent[0] ?? null, largestGap: years.slice(1).reduce((max, year, i) => Math.max(max, year - years[i]), 0), retainedYears: years};
}
