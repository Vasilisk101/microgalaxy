# Cross-version save retention — implementation and verification

Automatic retention is implemented in the application storage paths, not merely
in a planner. No production saves, cloud objects, permissions, or live databases
were changed through development tools. Publishing remains the root agent's job.

## User contract

- Default 200 MiB; settings offer 50/100/200/500 MiB.
- Device-local and cloud quotas are separate and explicitly labelled. Each
  aggregates classic/0.1–0.2 plus v03/v04/v05/v06/v07/v08. A repeated world ID in
  different models is not a collision.
- Accounting is UTF-8 JSON bytes for the current and retained previous
  checkpoint. This is a logical managed-save limit, **not** physical IndexedDB
  allocation, total R2 storage, metadata, or unknown legacy orphan-object usage.
- Oldest successful `updatedAt` first, with model/id tie-breaking. Whole archive
  records are removed; current/previous history is never silently truncated.
- Active, pinned, pending/uncertain, unknown-size and pre-protocol legacy worlds
  are protected. If protected records exceed the limit, preserve them and report
  blocked/incomplete usage instead of claiming the limit was enforced.
- Per-world 24 MiB portable/import cap remains unchanged for v03–v08. Classic's
  existing smaller server limit remains unchanged. No model is auto-migrated.
- Deleted archive IDs have durable tombstones: a stale cloud/local sync cannot
  automatically recreate them. A deliberately separate copy needs a fresh ID.

## Local protocol

`lib/local-retention.mjs`, `lib/local-retention-locks.mjs`, all six simulator
storage modules and `lib/local-worlds.ts` are integrated.

- All model databases keep their original names and use IDB coordination
  generation 3; upgrades do not bypass blocked old connections. If any old
  database cannot be safely upgraded, cross-version deletion is disabled.
- Real origin-wide Web Locks serialize writes, inventory, settings, pinning and
  deletion. Genuine long-lived shared per-world locks protect reads/open worlds;
  deletion requires an exclusive immediately available lock. No tab-local mutex
  or guessed heartbeat substitutes for this protocol.
- World data and retention metadata commit in the same IDB transaction. A
  detached input is captured before waiting. Existing revision/identity checks
  remain in place. Failed validation/transaction/QuotaExceeded never starts
  deletion before a successful checkpoint.
- Classic and v03/v04 catalogues are now metadata/key-only as well: they never
  call `worlds.getAll()` to list archives. Classic returns honest
  `{id, summary: null}` entries for unknown legacy metadata, not fake `World`
  objects. Bounded explicit metadata backfills run outside first render. The
  selected classic world is acquired/reread under its live lease before any
  cloud wait or installation, closing the previous first-checkpoint protection gap.
- Automatic cleanup is scheduled after the durable write returns, not before
  the first frame of a newly opened/created world. Inventory is bounded (two
  records per model after a save, eight per explicit archive inventory action).
- Old versions can close their database connection on `versionchange` while
  retaining dirty memory. Accordingly, measured legacy records remain protected
  even after an upgrade or coordinated rewrite; upgrade success is not treated
  as proof that an old tab has closed.
- `adoptLocalWorld(model,id,revision,observedRow,true)` requires explicit user
  confirmation that other tabs are closed and their changes saved/exported,
  an exclusive inactive-world lock, and atomic metadata-generation, revision,
  timestamp, pinned and dirty-state checks. An active/current world cannot be
  adopted. A conflict changes nothing.
- Tombstone + deletion + metadata removal share one transaction. Notices include
  model/id/name/bytes/time and status reads the latest ten persisted tombstones,
  so notices survive refresh. A transaction abort never creates a success notice.

Local UI API: `retentionStatus()`, `inventoryLocalRetention()`,
`setRetentionLimit(bytes)`, `setWorldPinned(model,id,bool)`, `adoptLocalWorld(...)`.
Simulator stores expose `releaseWorld(id)` after a successful final local write;
classic exposes `releaseLocalWorld(id)`. Unknown/missing Web Locks fail closed.

## Cloud protocol

`lib/retention-cloud.ts`, `/api/retention`, all existing/new world storage modules
and API routes are integrated. Additive migrations 0007–0014 define metadata,
leases, intents, tombstones, notices, explicit-adoption fencing and SQL triggers.
Earlier applied migration SQL and metadata were not rewritten.

- Every API operation authenticates first and scopes records to the current
  owner. Mutations and snapshot reads require protocol generation/session
  headers; obsolete callers receive 428. Normal same-origin/JSON/body-size
  protections remain. No service token or permission change is involved.
- A write intent is stored before an R2 upload. D1 triggers require the intent,
  reject tombstoned identities, and atomically update the current/previous byte
  ledger with the world pointer commit. Uncertain responses retain uploads and
  protection; only a known failed CAS releases its corresponding intent.
- The deletion statement atomically checks owner, revision, pointer, live quota,
  pin, legacy guard, pending intent and lease absence. SQL triggers independently
  enforce guards and atomically create tombstones/notices/garbage queue entries.
  Concurrent cleanup cannot reduce a live quota below its stopping threshold by
  relying on a stale precomputed total.
- Active cloud leases deliberately have no timeout: browser suspension,
  connectivity loss or a crashed tab cannot be guessed safe. Every renewal has
  a unique version. Clean normal departure releases the current session's lease;
  an uncertain departure can leave conservative protection behind.
- Every successful world POST/PUT/GET/304 returns its `X-Microgalaxy-Lease`
  receipt. Cloud transports (including classic) remember it. Normal release
  captures the old receipt synchronously before awaiting anything; the server
  deletes only that exact owner/model/id/session/version. A delayed release
  cannot remove a same-session lease renewed by rapidly reopening the world.
  Missing/uncertain receipts retain protection rather than guessing.
- Legacy HEAD inventory measures at most eight worlds per explicit action (two
  after a save); missing/uncertain objects remain unknown. Inventory never removes
  legacy protection. No large snapshot body downloads are used for byte counting.
- Explicit per-world `adopt` needs a human acknowledgement and an observed
  protection snapshot. One D1 batch compares world revision, pin, legacy flag,
  exact session set **and lease versions**, and absence of in-flight intents.
  It clears only explicitly observed old sessions and the legacy guard, never
  the calling session, a concurrent/renewed lease, new revision or racing pin.
  Stale state returns 409. This is not an account-wide lease reset.
- R2 cleanup only processes proven superseded/current/previous keys recorded by
  committed SQL operations, rechecking live pointers/intents before deletion.
  Arbitrary or uncertain orphan objects are not swept. Physical R2 hard-cap
  claims are explicitly unsupported.
- Durable per-owner notices retain at most fifty entries; status exposes the
  latest ten with name/model/id/bytes/time. An aborted DELETE also rolls back its
  notice. Returned status never exposes R2 keys or another owner's records.

Client API: `cloudRetention()` for status;
`cloudRetention('inventory'|'cleanup')`;
`cloudRetention('settings',{limitBytes})`;
`cloudRetention('pin',{model,id,pinned})`;
`cloudRetention('adopt',{model,id,revision,observed:row.protection,acknowledge:true})`;
`releaseCloudWorld(model,id)` only when the final sync is known clean.

## Verification

- Focused planner/lock/real IndexedDB/real SQLite retention tests cover
  exact legacy pin targeting, device quota failure, IDB upgrade
  blocking, legacy dirty-tab guards, owner isolation, cross-model ID collisions,
  tombstone resurrection prevention, concurrent cleanup, pin/pointer races,
  explicit adoption acknowledgement/CAS, renewed cloud leases and bounded notices.
- Previous-model and v08 API/storage/IDB regression subset: 114/114 passed before
  final legacy-adoption additions; those modules are included in the full suite.
- Final canonical `npm test`, run by root after the release-receipt CAS,
  classic protected-boot, and v03/v04 catalogue/UI fixes: **1041/1041 passed**,
  zero failed/cancelled/skipped/todo (95,260.705209 ms). This supersedes the
  intermediate 993/1005 and 1010/1010 runs. The twelve original fixture failures
  concerned old literal database-name locations, whole storage-file hashes,
  `Headers` access, and archive model counts; fixtures were aligned with the
  approved retention plumbing, while annual v03–v07 simulation cores remain
  unchanged.
- Independent final acceptance: **11/11** retention and **9/9** model checks,
  including actual classic boot under cleanup during the cloud wait, real IDB
  metadata-only catalogue interception and atomic failure, and stale-release CAS.
- v03/v04 `indexLegacy(2)` is wired after the catalogue's first display. The
  initial backend handoff's pending UI integration was completed by the UI owner
  and verified before the final full suite.
- Latest post-fix focused run: **88/88** (actual classic/v03/v04 IDB catalogue
  interception, legacy stores, SQL retention, actual client stale-release race).
  Separate post-release-receipt API/storage run: **77/77**, including receipt
  assertions on all v03–v08 actual POST/GET/PUT routes. Local notice reload and
  aborted-deletion tests: **13/13** local retention cases pass.
- Final `npm run typecheck` and the native Sites production build both passed
  on the frozen release sources. Build warnings (large chunks and static route
  classification) did not prevent output; they are not phone-performance evidence.
- Production/browser retention QA is not claimed. Root reported a browser URL
  security-policy block; no alternative path was used to evade it.

## Operational limits

Logical quota can remain exceeded because of protected worlds, incomplete
inventory, pending writes or a device's smaller physical quota. The correct
response is explicit blocked/error status plus export, pin management or the
per-world confirmed adoption flow—not preemptive deletion before a save succeeds.
Uncertain upload intents intentionally require future explicit reconciliation;
this release does not guess their outcomes or delete unverified objects.
