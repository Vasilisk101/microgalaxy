/** Every model has its own immutable engine, cloud table, local database and canonical URL. */
export const WORLD_MODELS = Object.freeze({
  classic: {label:'0.1–0.2', versionLabel:'0.1–0.2 · Классическая обсерватория', path:'/classic', table:'worlds', db:'microgalaxy-observatory-v1'},
  v03: {label:'0.3', versionLabel:'0.3 · Обсерватория', path:'/v03', table:'worlds_v03', db:'microgalaxy_local_candidate_v1'},
  v04: {label:'0.4', versionLabel:'0.4 · История цивилизаций', path:'/v04', table:'worlds_v04', db:'microgalaxy_history_v04_v1'},
  v05: {label:'0.5', versionLabel:'0.5 · География истории', path:'/v05', table:'worlds_v05', db:'microgalaxy_geography_v05_v1'},
  v06: {label:'0.6', versionLabel:'0.6 · Экономика и пути', path:'/v06', table:'worlds_v06', db:'microgalaxy_economy_v06_v1'},
  v07: {label:'0.7', versionLabel:'0.7 · Общества и знания', path:'/v07', table:'worlds_v07', db:'microgalaxy_societies_v07_v1'},
  v08: {label:'0.8', versionLabel:'0.8 · Конфликты и новый порядок', path:'/v08', table:'worlds_v08', db:'microgalaxy_conflicts_v08_v1'},
  v1: {label:'1.0', versionLabel:'1.0 · Ночная обсерватория', path:'/v1', table:'worlds_v1', db:'microgalaxy_observatory_v1_v1'},
});
