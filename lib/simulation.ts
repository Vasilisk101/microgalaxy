/** MICROGALAXY deterministic simulation kernel. No network, clock, UI, or AI dependencies. */
export const ENGINE_VERSION = '0.1.0';
export const MAX_YEAR = 10000;
export const MAX_ADVANCE_BATCH = 500;
export type Epoch = 'agrarian' | 'industrial';
export type PlanetKind = 'rocky' | 'ocean' | 'desert' | 'gas' | 'ice';
export type EventType = 'origin' | 'climate' | 'society' | 'science' | 'conflict' | 'space';
export interface Planet {
    id: string;
    name: string;
    kind: PlanetKind;
    orbit: number;
    radius: number;
    mass: number;
    temp: number;
    moons: number;
    water: number;
    seed: number;
    habitable: boolean;
    color: string;
}
export interface Society {
    id: string;
    name: string;
    color: string;
    lat: number;
    lon: number;
    population: number;
    food: number;
    industry: number;
    science: number;
    tech: number;
    stability: number;
    government: string;
    culture: string;
    planetId: string;
}
export interface WorldEvent {
    id: string;
    year: number;
    type: EventType;
    title: string;
    description: string;
    causes: string[];
    societyId?: string;
    planetId?: string;
    importance: number;
}
export interface Mission {
    id: string;
    name: string;
    type: 'satellite' | 'probe' | 'colony';
    ownerId: string;
    planetId: string;
    launchedAt: number;
    arrivalYear: number;
    active: boolean;
    population: number;
}
export interface HistoryPoint {
    year: number;
    population: number;
    tech: number;
    temperature: number;
    stability: number;
    food: number;
}
export interface World {
    schemaVersion: 1;
    engineVersion: string;
    id: string;
    name: string;
    seed: string;
    rng: number;
    year: number;
    startEpoch: Epoch;
    star: {
        name: string;
        type: string;
        mass: number;
        temperature: number;
        age: number;
        luminosity: number;
        color: string;
    };
    planets: Planet[];
    homePlanetId: string;
    societies: Society[];
    events: WorldEvent[];
    missions: Mission[];
    history: HistoryPoint[];
    climate: {
        temperature: number;
        rainfall: number;
    };
}
export interface WorldStats {
    population: number;
    tech: number;
    stability: number;
    food: number;
    era: string;
    societyCount: number;
    missionCount: number;
}
const COLORS = ['#d2b779', '#77bba9', '#a3adcf', '#c38885', '#a5b980'];
const ROOTS = ['Астер', 'Велор', 'Нерис', 'Талар', 'Ориан', 'Кейра', 'Селин', 'Эндар', 'Лиор', 'Аурен', 'Вега', 'Мирен', 'Элиан', 'Терра', 'Сайра', 'Илмар', 'Нивер', 'Арден', 'Кассар', 'Энна'];
const ENDINGS = ['а', 'ия', 'он', 'ис', 'ея', 'ум', ''];
const GOVERNMENTS = ['Совет общин', 'Союз городов', 'Наследственная власть', 'Выборный совет', 'Федерация общин'];
const CULTURES = ['Речные поселения', 'Прибрежные города', 'Нагорные общины', 'Степные союзы', 'Озёрные поселения'];
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round = (n: number, p = 4) => Math.round(n * 10 ** p) / 10 ** p;
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
} return h >>> 0; }
function rand(w: {
    rng: number;
}) { w.rng = (w.rng + 0x6D2B79F5) >>> 0; let t = w.rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const between = (r: {
    rng: number;
}, a: number, b: number) => a + (b - a) * rand(r);
const choose = <T>(r: {
    rng: number;
}, items: readonly T[]) => items[Math.floor(rand(r) * items.length)];
function makeName(r: {
    rng: number;
}) { return choose(r, ROOTS) + choose(r, ENDINGS); }
// Keep names unique without consuming RNG or changing the simulated history.
function uniqueName(base: string, used: Set<string>): string {
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base} ${suffix++}`;
    used.add(candidate);
    return candidate;
}
const number = (v: number) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function addEvent(w: World, e: Omit<WorldEvent, 'id' | 'year'>) { const index = w.events.reduce((n, x) => n + (x.year === w.year ? 1 : 0), 0); w.events.push({ ...e, id: `e-${w.year}-${index}`, year: w.year }); }
function lastEvent(w: World, type: EventType, id?: string) { for (let i = w.events.length - 1; i >= 0; i--)
    if (w.events[i].type === type && (!id || w.events[i].societyId === id))
        return w.events[i].year; return -1000; }
export function getEra(tech: number) { if (tech >= 86)
    return 'Межпланетная эпоха'; if (tech >= 68)
    return 'Космическая эпоха'; if (tech >= 52)
    return 'Эпоха электричества'; if (tech >= 35)
    return 'Индустриальная эпоха'; if (tech >= 22)
    return 'Эпоха городов'; return 'Ранние государства'; }
export function getWorldStats(w: World): WorldStats { const live = w.societies.filter(s => s.population > 0); const ground = live.reduce((n, s) => n + s.population, 0); const passengers = w.missions.filter(m => m.type === 'colony' && !m.active).reduce((n, m) => n + m.population, 0); const avg = (key: 'tech' | 'stability' | 'food') => ground ? live.reduce((n, s) => n + s[key] * s.population, 0) / ground : 0; const tech = avg('tech'); return { population: ground + passengers, tech, stability: avg('stability'), food: avg('food'), era: getEra(tech), societyCount: live.length, missionCount: w.missions.length }; }
function recordHistory(w: World) { const s = getWorldStats(w); w.history.push({ year: w.year, population: s.population, tech: round(s.tech), temperature: round(w.climate.temperature), stability: round(s.stability), food: round(s.food) }); if (w.history.length > 1024) {
    const first = w.history[0];
    const recent = w.history.slice(-384);
    const older = w.history.slice(1, -384).filter((_, i) => i % 2 === 0);
    w.history = [first, ...older, ...recent];
} }
export function createWorld(seed: string, options: {
    epoch?: Epoch;
    id?: string;
} = {}): World {
    if (typeof seed !== 'string' || !seed.trim() || seed.length > 96 || /[\u0000-\u001f]/.test(seed))
        throw new Error('Зерно мира должно содержать от 1 до 96 символов');
    const clean = seed.trim();
    const r = { rng: hash(clean) };
    const epoch = options.epoch ?? 'agrarian';
    if (!['agrarian', 'industrial'].includes(epoch))
        throw new Error('Неизвестная начальная эпоха');
    const starType = choose(r, ['K', 'G', 'F'] as const);
    const mass = round(between(r, ...(starType === 'K' ? [.72, .9] : starType === 'G' ? [.9, 1.1] : [1.1, 1.25]) as [
        number,
        number
    ]), 3);
    const luminosity = round(mass ** 3.7, 3);
    const starName = makeName(r);
    const count = 5 + Math.floor(rand(r) * 4);
    const homeIndex = 1 + Math.floor(rand(r) * 2);
    const homeOrbit = round(Math.sqrt(luminosity) * between(r, .94, 1.05), 3);
    const homeTemperature = round(between(r, 10, 23), 1);
    const planets: Planet[] = [];
    const planetNames = new Set<string>();
    for (let i = 0; i < count; i++) {
        const isHome = i === homeIndex;
        const orbit = round(homeOrbit * 1.72 ** (i - homeIndex) * between(r, .97, 1.03), 3);
        let kind: PlanetKind = isHome ? choose(r, ['rocky', 'ocean']) : i < homeIndex ? 'desert' : i > homeIndex + 1 && rand(r) > .4 ? 'gas' : choose(r, ['rocky', 'ice', 'desert']);
        const radius = round(isHome ? between(r, .85, 1.25) : kind === 'gas' ? between(r, 3.8, 9.5) : between(r, .35, 1.65), 2);
        const water = round(isHome ? between(r, .48, .77) : kind === 'ice' ? between(r, .2, .8) : kind === 'rocky' ? between(r, .01, .2) : 0, 2);
        planets.push({ id: `p-${i}`, name: uniqueName(makeName(r), planetNames), kind, orbit, radius, mass: round(kind === 'gas' ? radius ** 2.1 : radius ** 2.8, 2), temp: isHome ? homeTemperature : round(278 * luminosity ** .25 / Math.sqrt(orbit) - 273 + (kind === 'desert' ? between(r, 15, 70) : 0), 1), moons: Math.floor(rand(r) * (kind === 'gas' ? 19 : 3)), water, seed: Math.floor(rand(r) * 4294967296), habitable: isHome, color: kind === 'gas' ? '#bda88c' : kind === 'ice' ? '#a4b9cb' : kind === 'desert' ? '#bd8662' : kind === 'ocean' ? '#3b8199' : '#668c91' });
    }
    const home = planets[homeIndex];
    const societyCount = 3 + Math.floor(rand(r) * 3);
    const societyNames = new Set<string>();
    const societies: Society[] = Array.from({ length: societyCount }, (_, i) => ({ id: `s-${i}`, name: uniqueName(makeName(r), societyNames), color: COLORS[i], lat: round(between(r, -48, 55), 2), lon: round(-150 + i * (300 / societyCount) + between(r, -16, 16), 2), population: Math.floor(between(r, epoch === 'industrial' ? 900000 : 140000, epoch === 'industrial' ? 3800000 : 650000)), food: round(between(r, .55, 1.4)), industry: round(between(r, epoch === 'industrial' ? 40 : 10, epoch === 'industrial' ? 62 : 23)), science: round(between(r, epoch === 'industrial' ? 35 : 8, epoch === 'industrial' ? 55 : 20)), tech: round(between(r, epoch === 'industrial' ? 41 : 12, epoch === 'industrial' ? 49 : 20)), stability: round(between(r, 52, 84)), government: choose(r, GOVERNMENTS), culture: CULTURES[i], planetId: home.id }));
    const w: World = { schemaVersion: 1, engineVersion: ENGINE_VERSION, id: options.id ?? `world-${hash(clean).toString(16)}`, name: `Система ${starName}`, seed: clean, rng: r.rng, year: 0, startEpoch: epoch, star: { name: starName, type: `${starType}${Math.floor(rand(r) * 6)} V`, mass, temperature: Math.round(starType === 'K' ? between(r, 4300, 5150) : starType === 'G' ? between(r, 5300, 6000) : between(r, 6100, 6650)), age: round(between(r, 1.8, starType === 'F' ? 4 : 7.5), 2), luminosity, color: starType === 'K' ? '#ffd09b' : starType === 'G' ? '#ffe8bc' : '#edf2ff' }, planets, homePlanetId: home.id, societies, events: [], missions: [], history: [], climate: { temperature: homeTemperature, rainfall: 1 } };
    w.rng = r.rng;
    addEvent(w, { type: 'origin', title: 'Начало наблюдения', description: `${home.name}: ${societies.length} обществ начинают самостоятельную историю. География, биосфера и исходные общества заданы при создании мира.`, causes: [`Исходное зерно: ${clean}`, `Начальная эпоха: ${epoch === 'agrarian' ? 'ранние государства' : 'индустриальные общества'}`], planetId: home.id, importance: 3 });
    recordHistory(w);
    if (!validateWorld(w))
        throw new Error('Не удалось создать корректный мир');
    return w;
}
function developSociety(w: World, s: Society, home: Planet) { if (s.population === 0)
    return; const oldPop = s.population, oldTech = s.tech, oldFood = s.food, oldStability = s.stability; const homeSociety = s.planetId === w.homePlanetId; const local = hash(s.id + w.seed) / 4294967296; const weather = homeSociety ? clamp(w.climate.rainfall * (1 - Math.abs(w.climate.temperature - home.temp) / 45) * (1 - .12 * Math.abs(s.lat) / 60), .18, 1.3) : .94; const capacity = homeSociety ? 2800000 * home.radius ** 2 * (1 - home.water) / .35 * (.6 + s.tech / 28) * (0.7 + s.industry / 90) : 45000 * (.8 + s.tech / 30) * (1 + s.industry / 70); const density = s.population / capacity; const harvestNoise = between(w, .94, 1.06); const labor = clamp(.6 + s.stability / 160, .5, 1.18); const productionPerPerson = clamp((1.03 + s.tech * .004 + s.industry * .001) * weather * labor * clamp(1.5 - .6 * density, .25, 1.35) * harvestNoise, .1, 2.2); const stock = Math.max(0, oldFood * oldPop * .88 + oldPop * productionPerPerson - oldPop); const shortage = stock / oldPop; const growth = clamp(.015 * (1 - density) + s.tech * .000045 + (shortage > .8 ? .003 : 0) - (shortage < .2 ? .035 * (1 - shortage / .2) : 0), -.05, .024); s.population = Math.max(0, Math.round(oldPop * (1 + growth))); if (s.population < 100)
    s.population = 0; s.food = s.population ? round(clamp(stock / s.population, 0, 3)) : 0; const target = clamp(71 + s.food * 6 - s.industry * .09 - (s.food < .3 ? 35 : 0) + (local - .5) * 12, 15, 92); s.stability = round(clamp(s.stability + (target - s.stability) * .075 + between(w, -.8, .8), 0, 100)); const support = clamp(s.stability / 70, .05, 1.2) * clamp(s.food + .35, .2, 1.3); s.industry = round(clamp(s.industry + (.025 + s.tech * .0025) * support - (s.food < .15 ? .18 : 0), 0, 100)); s.science = round(clamp(s.science + (.025 + s.industry * .0014) * support - (s.stability < 30 ? .12 : 0), 0, 100)); s.tech = round(clamp(s.tech + (.035 + s.science * .004) * support * (1 - s.tech / 130), 0, 100)); if (getEra(s.tech) !== getEra(oldTech))
    addEvent(w, { type: 'science', title: `${s.name}: ${getEra(s.tech).toLowerCase()}`, description: `Накопленные знания и хозяйственные возможности изменили доступные обществу технологии.`, causes: [`Развитие исследований: ${Math.round(s.science)} из 100`, `Производственная база: ${Math.round(s.industry)} из 100`, `Устойчивость институтов: ${Math.round(s.stability)} из 100`], societyId: s.id, planetId: s.planetId, importance: 3 }); if (oldFood >= .25 && s.food < .25 && w.year - lastEvent(w, 'climate', s.id) > 18)
    addEvent(w, { type: 'climate', title: `Нехватка продовольствия: ${s.name}`, description: `Запасы сократились до ${Math.round(s.food * 12)} месяцев потребления. Недостаток питания снижает рост населения и доверие к власти.`, causes: [`Производство покрывает ${Math.round(productionPerPerson * 100)}% годовой потребности`, homeSociety ? `Обеспеченность осадками: ${Math.round(w.climate.rainfall * 100)}%` : 'Производство ограничено возможностями замкнутого поселения'], societyId: s.id, planetId: s.planetId, importance: 2 }); if (oldStability < 45 && s.stability >= 55 && w.year - lastEvent(w, 'society', s.id) > 25)
    addEvent(w, { type: 'society', title: `Восстановление устойчивости: ${s.name}`, description: 'Снабжение и работа институтов восстановились после периода напряжения.', causes: [`Запасы пищи: ${round(s.food, 1)} годового потребления`, `Устойчивость достигла ${Math.round(s.stability)} из 100`], societyId: s.id, planetId: s.planetId, importance: 2 }); const politicalDraw = rand(w); if (s.stability < 40 && politicalDraw < .08 && w.year - lastEvent(w, 'society', s.id) > 30) {
    const former = s.government;
    s.government = choose(w, GOVERNMENTS.filter(g => g !== former));
    s.stability = round(Math.min(100, s.stability + 12));
    addEvent(w, { type: 'society', title: `Смена устройства власти: ${s.name}`, description: `${former} уступает место новому устройству: ${s.government.toLowerCase()}. Перераспределение полномочий временно укрепляет согласие.`, causes: [`Устойчивость до реформы: ${Math.round(s.stability - 12)} из 100`, `Запасы продовольствия: ${round(s.food, 1)} годового потребления`], societyId: s.id, planetId: s.planetId, importance: 3 });
} if (s.food < .18 && s.stability < 45 && s.population > 100000 && politicalDraw > .94 && w.year - lastEvent(w, 'conflict', s.id) > 45) {
    const loss = Math.floor(s.population * between(w, .006, .025));
    s.population -= loss;
    s.industry = round(s.industry * .94);
    s.stability = round(clamp(s.stability - 4, 0, 100));
    addEvent(w, { type: 'conflict', title: `Внутренний конфликт: ${s.name}`, description: `Спор о доступе к продовольствию перерос в столкновения. Потеряно ${number(loss)} жителей; повреждены производственные мощности.`, causes: ['Продолжительная нехватка пищи', `Низкая устойчивость институтов: ${Math.round(s.stability + 4)} из 100`], societyId: s.id, planetId: s.planetId, importance: 3 });
} if (s.population === 0 && oldPop > 0)
    addEvent(w, { type: 'society', title: `Прекращение существования: ${s.name}`, description: 'Последние устойчивые поселения исчезли. Их название и история остаются в хронике.', causes: ['Длительное сокращение населения', 'Неспособность поддерживать снабжение'], societyId: s.id, planetId: s.planetId, importance: 3 }); }
function exchange(w: World) {
    const local = w.societies.filter(s => s.planetId === w.homePlanetId && s.population > 0);
    for (const needy of local.filter(s => s.food < .55)) {
        for (const donor of local.filter(s => s.id !== needy.id && s.food > 1.3)) {
            const amount = Math.min((donor.food - 1.3) * donor.population, (.6 - needy.food) * needy.population, donor.population * .045);
            if (amount <= 0)
                continue;
            donor.food = round(donor.food - amount / donor.population);
            needy.food = round(needy.food + amount / needy.population);
            needy.stability = round(Math.min(100, needy.stability + .3));
            if (w.year - lastEvent(w, 'society', needy.id) > 60)
                addEvent(w, { type: 'society', title: `Поставки продовольствия: ${needy.name}`, description: `Общество «${donor.name}» направляет часть излишков по наземным торговым путям. Поставки смягчают нехватку пищи.`, causes: [`Запасы получателя до поставки: ${round(needy.food - amount / needy.population, 2)} годового потребления`, `Излишки у поставщика: ${round(donor.food + amount / donor.population, 1)} годового потребления`], societyId: needy.id, planetId: w.homePlanetId, importance: 1 });
        }
    }
    const highest = Math.max(0, ...local.map(s => s.tech));
    for (const s of local)
        if (s.tech > 22 && s.food > .25 && s.stability > 40) {
            const former = s.tech;
            s.tech = round(clamp(s.tech + (highest - s.tech) * .003, 0, 100));
            if (getEra(former) !== getEra(s.tech))
                addEvent(w, { type: 'science', title: `${s.name}: ${getEra(s.tech).toLowerCase()}`, description: 'Контакты с более развитыми соседями позволили освоить накопленные ими знания.', causes: [`Технологическое развитие соседей: ${Math.round(highest)} из 100`, 'Торговые связи и устойчивые институты передачи знаний'], societyId: s.id, planetId: s.planetId, importance: 3 });
        }
}
function spaceflight(w: World) {
    for (const s of [...w.societies]) {
        if (s.population < 150000 || s.food < .8 || s.stability < 48 || s.industry < 40)
            continue;
        const own = w.missions.filter(m => m.ownerId === s.id);
        let type: Mission['type'] | null = null;
        if (s.tech >= 68 && !own.some(m => m.type === 'satellite'))
            type = 'satellite';
        else if (s.tech >= 75 && own.some(m => m.type === 'satellite' && m.active) && !own.some(m => m.type === 'probe'))
            type = 'probe';
        else if (s.tech >= 86 && s.planetId === w.homePlanetId && own.some(m => m.type === 'probe' && m.active) && !own.some(m => m.type === 'colony'))
            type = 'colony';
        if (!type)
            continue;
        const candidates = w.planets.filter(p => p.id !== s.planetId && p.kind !== 'gas');
        const target = type === 'satellite' ? w.planets.find(p => p.id === s.planetId)! : candidates.sort((a, b) => Math.abs(a.orbit - w.planets.find(p => p.id === s.planetId)!.orbit) - Math.abs(b.orbit - w.planets.find(p => p.id === s.planetId)!.orbit))[Math.floor(rand(w) * Math.min(2, candidates.length))];
        if (!target)
            continue;
        const emigrants = type === 'colony' ? Math.min(18000, Math.floor(s.population * .012)) : 0;
        const mission: Mission = { id: `m-${s.id}-${type}`, name: type === 'satellite' ? `Орбита · ${s.name}` : type === 'probe' ? `Горизонт · ${target.name}` : `Поселение · ${target.name}`, type, ownerId: s.id, planetId: target.id, launchedAt: w.year, arrivalYear: w.year + (type === 'satellite' ? 1 : type === 'probe' ? Math.max(2, Math.round(3 + target.orbit * 1.4)) : Math.max(5, Math.round(6 + target.orbit * 2))), active: false, population: emigrants };
        const departureStock = s.food * s.population;
        s.population -= emigrants;
        if (emigrants)
            s.food = round(clamp((departureStock - emigrants * 2) / s.population, 0, 3));
        s.industry = round(Math.max(0, s.industry - (type === 'colony' ? 4 : 1.5)));
        w.missions.push(mission);
        addEvent(w, { type: 'space', title: type === 'satellite' ? `Первый спутник общества «${s.name}»` : type === 'probe' ? `Экспедиция к планете «${target.name}»` : `Переселенцы отправились к планете «${target.name}»`, description: type === 'satellite' ? 'Аппарат выведен на траекторию; после завершения развёртывания начнутся наблюдения.' : type === 'probe' ? `Автоматический аппарат направлен к соседнему миру. Прибытие ожидается в ${mission.arrivalYear} году.` : `${number(emigrants)} переселенцев покинули родную планету. Для жизни на планете «${target.name}» потребуется замкнутая среда.`, causes: [`Технологическое развитие: ${Math.round(s.tech)} из 100`, `Производственная база до запуска: ${Math.round(s.industry + (type === 'colony' ? 4 : 1.5))} из 100`, 'Запасы продовольствия и устойчивость позволяют выделить ресурсы'], societyId: s.id, planetId: target.id, importance: 3 });
    }
    for (const m of w.missions) {
        if (m.active || m.arrivalYear > w.year)
            continue;
        m.active = true;
        const parent = w.societies.find(s => s.id === m.ownerId)!;
        const target = w.planets.find(p => p.id === m.planetId)!;
        if (m.type === 'colony') {
            w.societies.push({ id: `c-${m.ownerId}`, name: uniqueName(`${target.name} · ${parent.name}`, new Set(w.societies.map(s => s.name))), color: parent.color, lat: round(between(w, -35, 35), 2), lon: round(between(w, -170, 170), 2), population: m.population, food: 1.8, industry: 20, science: round(parent.science * .65), tech: round(Math.max(0, parent.tech - 2)), stability: 76, government: 'Совет поселения', culture: `Наследие общества «${parent.name}»`, planetId: target.id });
            addEvent(w, { type: 'space', title: `Основано поселение на планете «${target.name}»`, description: `${number(m.population)} переселенцев развернули самостоятельное поселение с замкнутой системой жизнеобеспечения.`, causes: [`Экспедиция общества «${parent.name}» прибыла после ${m.arrivalYear - m.launchedAt} лет пути`, 'Перевезены люди, оборудование и знания'], societyId: `c-${m.ownerId}`, planetId: target.id, importance: 3 });
        }
        else
            addEvent(w, { type: 'space', title: m.type === 'satellite' ? `Спутник общества «${parent.name}» начал работу` : `Аппарат достиг планеты «${target.name}»`, description: m.type === 'satellite' ? 'Систематические орбитальные наблюдения дополняют знания о родной планете.' : 'Наблюдения соседнего мира переданы обществу, отправившему экспедицию.', causes: [`Аппарат отправлен в ${m.launchedAt} году`, 'Завершены перелёт и развёртывание'], societyId: parent.id, planetId: target.id, importance: 2 });
        parent.science = round(Math.min(100, parent.science + (m.type === 'satellite' ? 2 : 4)));
    }
}
function annualStep(w: World) { w.year++; const home = w.planets.find(p => p.id === w.homePlanetId)!; const forcing = rand(w); const phase = (hash(w.seed + 'climate') % 628) / 100; const targetRain = 1 + .09 * Math.sin(w.year / 11 + phase) + .06 * Math.sin(w.year / 37); w.climate.rainfall = round(clamp(w.climate.rainfall * .84 + targetRain * .16 + (forcing < .027 ? -.33 : forcing > .985 ? .23 : between(w, -.025, .025)), .32, 1.48)); const industry = w.societies.filter(s => s.planetId === home.id).reduce((a, s) => a + s.industry * s.population, 0); const heat = clamp(industry / 800000000, 0, 3.2); w.climate.temperature = round(home.temp + .7 * Math.sin(w.year / 19 + phase) + .3 * Math.sin(w.year / 61) + heat, 3); if (w.climate.rainfall < .68 && w.year - lastEvent(w, 'climate') > 15)
    addEvent(w, { type: 'climate', title: `Засушливый период на планете «${home.name}»`, description: 'Сокращение осадков снижает урожайность. Последствия для обществ зависят от запасов, плотности населения и торговли.', causes: [`Обеспеченность осадками: ${Math.round(w.climate.rainfall * 100)}% среднего уровня`, `Средняя температура: ${round(w.climate.temperature, 1)} °C`], planetId: home.id, importance: 2 }); for (const s of w.societies)
    developSociety(w, s, home); exchange(w); spaceflight(w); recordHistory(w); }
export function advanceWorld(world: World, years: number): World { if (!Number.isInteger(years) || years < 0 || years > MAX_YEAR)
    throw new Error('Шаг должен быть целым числом лет от 0 до 10 000'); if (!validateWorld(world))
    throw new Error('Сохранение несовместимо или повреждено'); const next = structuredClone(world); for (let i = 0, n = Math.min(years, MAX_YEAR - next.year); i < n; i++)
    annualStep(next); return next; }

export type AdvanceStop = '' | 'event' | 'important' | 'limit' | 'none';
export interface AdvanceBatchResult {
    world: World;
    advanced: number;
    stopped: AdvanceStop;
}
/**
 * Advance a bounded worker request without repeatedly cloning its growing
 * history. The annual rules and event ordering are the same as advanceWorld;
 * only the boundary at which we validate and copy the input is different.
 */
export function advanceWorldBatch(
    world: World,
    years: number,
    options: { untilEvent?: boolean; autoPause?: boolean } = {},
): AdvanceBatchResult {
    if (!Number.isInteger(years) || years < 0 || years > MAX_ADVANCE_BATCH)
        throw new Error('Порция расчёта должна содержать от 0 до 500 целых лет');
    // Reuse the public snapshot boundary, validating and copying exactly once.
    const next = advanceWorld(world, 0);
    const startYear = next.year;
    let stopped: AdvanceStop = '';
    for (let i = 0; i < years && next.year < MAX_YEAR; i++) {
        const eventStart = next.events.length;
        annualStep(next);
        let significant = false;
        let important = false;
        for (let j = eventStart; j < next.events.length; j++) {
            significant ||= next.events[j].importance >= 2;
            important ||= next.events[j].importance >= 3;
        }
        // "Until event" wins when both options are enabled, matching the UI's
        // previous worker behavior. The world stops after the whole year.
        if (options.untilEvent && significant) { stopped = 'event'; break; }
        if (options.autoPause && important) { stopped = 'important'; break; }
    }
    if (next.year >= MAX_YEAR) stopped = 'limit';
    else if (options.untilEvent && !stopped) stopped = 'none';
    return { world: next, advanced: next.year - startYear, stopped };
}
// Snapshot validation protects both local import and server persistence.
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const str = (v: unknown, max = 160): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
const id = (v: unknown): v is string => str(v, 100) && /^[a-zA-Z0-9_-]+$/.test(v);
const num = (v: unknown, a: number, b: number, int = false): v is number => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b && (!int || Number.isInteger(v));
const color = (v: unknown) => typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v);
const keys = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every(k => allowed.includes(k));
const unique = (a: {
    id: string;
}[]) => new Set(a.map(x => x.id)).size === a.length;
export function validateWorld(input: unknown): input is World { try {
    if (!isObject(input) || !keys(input, ['schemaVersion', 'engineVersion', 'id', 'name', 'seed', 'rng', 'year', 'startEpoch', 'star', 'planets', 'homePlanetId', 'societies', 'events', 'missions', 'history', 'climate']))
        return false;
    const w = input;
    if (w.schemaVersion !== 1 || w.engineVersion !== ENGINE_VERSION || !id(w.id) || !str(w.name, 100) || !str(w.seed, 96) || !num(w.rng, 0, 4294967295, true) || !num(w.year, 0, MAX_YEAR, true) || !['agrarian', 'industrial'].includes(String(w.startEpoch)))
        return false;
    if (!isObject(w.star) || !keys(w.star, ['name', 'type', 'mass', 'temperature', 'age', 'luminosity', 'color']))
        return false;
    const st = w.star;
    if (!str(st.name, 80) || !str(st.type, 16) || !num(st.mass, .1, 10) || !num(st.temperature, 1000, 50000) || !num(st.age, 0, 20) || !num(st.luminosity, .0001, 10000) || !color(st.color))
        return false;
    if (!isObject(w.climate) || !keys(w.climate, ['temperature', 'rainfall']) || !num(w.climate.temperature, -150, 150) || !num(w.climate.rainfall, 0, 3))
        return false;
    if (!Array.isArray(w.planets) || w.planets.length < 5 || w.planets.length > 8)
        return false;
    for (const p of w.planets) {
        if (!isObject(p) || !keys(p, ['id', 'name', 'kind', 'orbit', 'radius', 'mass', 'temp', 'moons', 'water', 'seed', 'habitable', 'color']) || !id(p.id) || !str(p.name, 80) || !['rocky', 'ocean', 'desert', 'gas', 'ice'].includes(String(p.kind)) || !num(p.orbit, .01, 1000) || !num(p.radius, .05, 30) || !num(p.mass, .001, 10000) || !num(p.temp, -273.15, 2000) || !num(p.moons, 0, 1000, true) || !num(p.water, 0, 1) || !num(p.seed, 0, 4294967295, true) || typeof p.habitable !== 'boolean' || !color(p.color))
            return false;
    }
    const planets = w.planets as unknown as Planet[];
    if (!unique(planets) || !id(w.homePlanetId) || !planets.some(p => p.id === w.homePlanetId && p.habitable))
        return false;
    const pids = new Set(planets.map(p => p.id));
    if (!Array.isArray(w.societies) || w.societies.length < 3 || w.societies.length > 12)
        return false;
    for (const s of w.societies) {
        if (!isObject(s) || !keys(s, ['id', 'name', 'color', 'lat', 'lon', 'population', 'food', 'industry', 'science', 'tech', 'stability', 'government', 'culture', 'planetId']) || !id(s.id) || !str(s.name, 100) || !color(s.color) || !num(s.lat, -90, 90) || !num(s.lon, -180, 180) || !num(s.population, 0, 1e10, true) || !num(s.food, 0, 3.01) || !num(s.industry, 0, 100) || !num(s.science, 0, 100) || !num(s.tech, 0, 100) || !num(s.stability, 0, 100) || !str(s.government, 100) || !str(s.culture, 160) || !pids.has(String(s.planetId)))
            return false;
    }
    const societies = w.societies as unknown as Society[];
    if (!unique(societies))
        return false;
    const sids = new Set(societies.map(s => s.id));
    if (!Array.isArray(w.events) || w.events.length < 1 || w.events.length > 20000)
        return false;
    let eventYear = -1;
    for (const e of w.events) {
        if (!isObject(e) || !keys(e, ['id', 'year', 'type', 'title', 'description', 'causes', 'societyId', 'planetId', 'importance']) || !id(e.id) || !num(e.year, 0, w.year as number, true) || e.year < eventYear || !['origin', 'climate', 'society', 'science', 'conflict', 'space'].includes(String(e.type)) || !str(e.title, 200) || !str(e.description, 1000) || !num(e.importance, 1, 3, true) || !Array.isArray(e.causes) || e.causes.length < 1 || e.causes.length > 8 || !e.causes.every(c => str(c, 400)) || (e.societyId !== undefined && !sids.has(String(e.societyId))) || (e.planetId !== undefined && !pids.has(String(e.planetId))))
            return false;
        eventYear = e.year as number;
    }
    if (!unique(w.events as unknown as WorldEvent[]))
        return false;
    if (!Array.isArray(w.missions) || w.missions.length > 40)
        return false;
    for (const m of w.missions) {
        if (!isObject(m) || !keys(m, ['id', 'name', 'type', 'ownerId', 'planetId', 'launchedAt', 'arrivalYear', 'active', 'population']) || !id(m.id) || !str(m.name, 160) || !['satellite', 'probe', 'colony'].includes(String(m.type)) || !sids.has(String(m.ownerId)) || !pids.has(String(m.planetId)) || !num(m.launchedAt, 0, w.year as number, true) || !num(m.arrivalYear, m.launchedAt as number, MAX_YEAR + 5000, true) || typeof m.active !== 'boolean' || (m.active && (m.arrivalYear as number) > (w.year as number)) || !num(m.population, 0, 1e8, true))
            return false;
    }
    if (!unique(w.missions as unknown as Mission[]))
        return false;
    if (!Array.isArray(w.history) || w.history.length < 1 || w.history.length > 1024)
        return false;
    let hy = -1;
    for (const h of w.history) {
        if (!isObject(h) || !keys(h, ['year', 'population', 'tech', 'temperature', 'stability', 'food']) || !num(h.year, 0, w.year as number, true) || h.year <= hy || !num(h.population, 0, 1e11, true) || !num(h.tech, 0, 100) || !num(h.temperature, -150, 150) || !num(h.stability, 0, 100) || !num(h.food, 0, 3.01))
            return false;
        hy = h.year as number;
    }
    if (w.history[0].year !== 0 || hy !== w.year)
        return false;
    return true;
}
catch {
    return false;
} }
