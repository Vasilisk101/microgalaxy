# MICROGALAXY 0.6 — «Экономика и пути»

0.6 adds an observer-only aggregate economy for newly created worlds. Food, raw materials, energy and equipment are held in regional stocks or moving shipments. Production, consumption, construction, maintenance and losses are accounted for per year. Regional specialization, physical land/sea links, ports, capacity, travel time, access, resource depletion and recovery interact with shortages, migration and politics. Model units and distances are illustrative, not physical predictions. No economy micromanagement or generative AI is offered.

The economy page displays actual stocks, annual flows and balance residuals, region specialization and shortages, route status/capacity, shipments and related historical events. Route and shipment lists show displayed and total counts and load additional batches on request. Saved historical slices use their own economy state, not present-day state. The globe's existing routes layer remains a migration visualization, not a cargo-flow map.

## Compatibility

0.6 has a separate model, schema, local database and cloud endpoint. Its canonical world link is `/v06?world=…`; `/v05?world=…` opens 0.5, while the legacy `/?world=…` also remains 0.5. An unqualified `/` opens 0.6. The combined catalog distinguishes 0.6, 0.5, 0.4, 0.3 and classic. There is no automatic conversion or overwrite of old worlds. Saved snapshots and imports remain model-specific.

## Visual continuity

The approved design 03 «Сигнальный архив» visual language remains: light industrial surfaces, dark globe, restrained red, cut corners, static fine lines and local Noto fonts. Desktop passport/scene/history and compact mobile horizontal navigation are retained. The globe renderer reuses cached textures and the existing canvas.

## Verification and limitations

Both `node simulator-v05/build.mjs` and `node simulator-v06/build.mjs` succeeded. The UI integration command is `timeout 120s node --test simulator-v05/tests/catalog-ui.test.mjs simulator-v06/tests/{build.test.mjs,catalog-ui.test.mjs,economy-pagination.test.mjs,ui-save-state.test.mjs,renderer-performance.test.mjs,ui-smoke.test.mjs}`; it passed 75/75 after the final validator changes in 56.84 s. The migration-line fixture is from 0.5 because a given 0.6 seed need not produce migrations. Independent model review passed three 200-year seeds and separate 40-year war and colonial scenarios. Root reports `npm run typecheck` and native production build passed; bundler warnings concerned legacy chunk size and route classifications. Publication is a separate step.

The final host benchmark for seed `long-run` advanced 10,000 years in ten 1,000-year calls: 90.447 s total, including 77.315 s advancing, 2.679 s validation, and 10.452 s export/import. JSON was 8,258,712 bytes; export was 9,424,150 bytes of the 25,165,824-byte limit and decoded back to year 10,000. The world had 5,055 events, 64 snapshots, and population 149,028 → 426,299; maximum absolute resource-balance residual was 2.38e-7 in floating point.

These timings describe the test host only, not phone performance. Automated DOM/canvas tests do not establish real browser visual quality or mobile touch usability. The managed browser preview was previously unavailable; no real phone or browser visual QA is claimed without a successful later run.
