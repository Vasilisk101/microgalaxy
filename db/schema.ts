import { index, integer, real, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

// World data is stored as immutable R2 snapshots. This table is the atomic
// pointer to the current snapshot and the owner-scoped catalogue.
export const worlds = sqliteTable(
  "worlds",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    seed: text("seed").notNull(),
    year: integer("year").notNull(),
    population: real("population").notNull(),
    era: text("era").notNull(),
    revision: integer("revision").notNull(),
    snapshotKey: text("snapshot_key").notNull(),
    previousSnapshotKey: text("previous_snapshot_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("worlds_owner_updated_idx").on(table.ownerId, table.updatedAt)],
);

// New-model worlds have their own catalogue and R2 namespace. The legacy table
// and snapshots are not migrated, overwritten, or interpreted by the 0.3 engine.
export const worldsV03 = sqliteTable(
  "worlds_v03",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    seed: text("seed").notNull(),
    startingEra: text("starting_era").notNull(),
    schemaVersion: text("schema_version").notNull(),
    modelVersion: text("model_version").notNull(),
    year: integer("year").notNull(),
    population: real("population").notNull(),
    era: text("era").notNull(),
    revision: integer("revision").notNull(),
    snapshotKey: text("snapshot_key").notNull(),
    previousSnapshotKey: text("previous_snapshot_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("worlds_v03_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id)],
);

// Civilization histories use a separate format and catalogue. The 0.3 and
// classic archives stay readable by their original engines and are never migrated.
export const worldsV04 = sqliteTable(
  "worlds_v04",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    seed: text("seed").notNull(),
    startingEra: text("starting_era").notNull(),
    schemaVersion: text("schema_version").notNull(),
    modelVersion: text("model_version").notNull(),
    year: integer("year").notNull(),
    population: real("population").notNull(),
    era: text("era").notNull(),
    revision: integer("revision").notNull(),
    snapshotKey: text("snapshot_key").notNull(),
    previousSnapshotKey: text("previous_snapshot_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("worlds_v04_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id)],
);

// Geography/archival worlds never overwrite any previous model's catalogue.
export const worldsV05 = sqliteTable(
  "worlds_v05",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    seed: text("seed").notNull(),
    startingEra: text("starting_era").notNull(),
    schemaVersion: text("schema_version").notNull(),
    modelVersion: text("model_version").notNull(),
    year: integer("year").notNull(),
    population: real("population").notNull(),
    era: text("era").notNull(),
    revision: integer("revision").notNull(),
    snapshotKey: text("snapshot_key").notNull(),
    previousSnapshotKey: text("previous_snapshot_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("worlds_v05_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id)],
);

// Economy worlds are distinct records; prior model archives remain untouched.
export const worldsV06 = sqliteTable(
  "worlds_v06",
  {
    id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
    name: text("name").notNull(), seed: text("seed").notNull(),
    startingEra: text("starting_era").notNull(), schemaVersion: text("schema_version").notNull(),
    modelVersion: text("model_version").notNull(), year: integer("year").notNull(),
    population: real("population").notNull(), era: text("era").notNull(),
    revision: integer("revision").notNull(), snapshotKey: text("snapshot_key").notNull(),
    previousSnapshotKey: text("previous_snapshot_key"), createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("worlds_v06_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id)],
);

// Societies worlds are new records, never a conversion of older models.
export const worldsV07 = sqliteTable(
  "worlds_v07",
  {
    id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
    name: text("name").notNull(), seed: text("seed").notNull(),
    startingEra: text("starting_era").notNull(), schemaVersion: text("schema_version").notNull(),
    modelVersion: text("model_version").notNull(), year: integer("year").notNull(),
    population: real("population").notNull(), era: text("era").notNull(),
    revision: integer("revision").notNull(), snapshotKey: text("snapshot_key").notNull(),
    previousSnapshotKey: text("previous_snapshot_key"), createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("worlds_v07_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id)],
);

// Conflict-model worlds remain isolated from all earlier engines.
export const worldsV08 = sqliteTable(
  "worlds_v08",
  {
    id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
    name: text("name").notNull(), seed: text("seed").notNull(),
    startingEra: text("starting_era").notNull(), schemaVersion: text("schema_version").notNull(),
    modelVersion: text("model_version").notNull(), year: integer("year").notNull(),
    population: real("population").notNull(), era: text("era").notNull(),
    revision: integer("revision").notNull(), snapshotKey: text("snapshot_key").notNull(),
    previousSnapshotKey: text("previous_snapshot_key"), createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("worlds_v08_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id)],
);

export const worldsV1 = sqliteTable(
  "worlds_v1",
  {
    id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
    name: text("name").notNull(), seed: text("seed").notNull(),
    startingEra: text("starting_era").notNull(), schemaVersion: text("schema_version").notNull(),
    modelVersion: text("model_version").notNull(), year: integer("year").notNull(),
    population: real("population").notNull(), era: text("era").notNull(),
    revision: integer("revision").notNull(), snapshotKey: text("snapshot_key").notNull(),
    previousSnapshotKey: text("previous_snapshot_key"), createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("worlds_v1_owner_updated_idx").on(table.ownerId, table.updatedAt, table.id)],
);

export const retentionSettings = sqliteTable('retention_settings', {
  ownerId:text('owner_id').primaryKey(),limitBytes:integer('limit_bytes').notNull().default(209715200),generation:integer('generation').notNull().default(1),
});
export const retentionEntries=sqliteTable('retention_entries',{
  ownerId:text('owner_id').notNull(),model:text('model').notNull(),worldId:text('world_id').notNull(),
  revision:integer('revision').notNull(),snapshotKey:text('snapshot_key').notNull(),previousSnapshotKey:text('previous_snapshot_key'),
  currentBytes:integer('current_bytes'),previousBytes:integer('previous_bytes'),pinned:integer('pinned').notNull().default(0),updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.model,t.worldId]}),index('retention_entries_owner_time').on(t.ownerId,t.updatedAt)]);
export const retentionIntents=sqliteTable('retention_intents',{
  snapshotKey:text('snapshot_key').primaryKey(),ownerId:text('owner_id').notNull(),model:text('model').notNull(),worldId:text('world_id').notNull(),bytes:integer('bytes').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('retention_intents_world').on(t.ownerId,t.model,t.worldId)]);
export const retentionLeases=sqliteTable('retention_leases',{
  ownerId:text('owner_id').notNull(),model:text('model').notNull(),worldId:text('world_id').notNull(),session:text('session').notNull(),createdAt:text('created_at').notNull(),version:text('version').notNull().default(''),
},t=>[primaryKey({columns:[t.ownerId,t.model,t.worldId,t.session]})]);
export const retentionTombstones=sqliteTable('retention_tombstones',{
  ownerId:text('owner_id').notNull(),model:text('model').notNull(),worldId:text('world_id').notNull(),deletedAt:text('deleted_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.model,t.worldId]})]);
export const retentionGarbage=sqliteTable('retention_garbage',{
  snapshotKey:text('snapshot_key').primaryKey(),ownerId:text('owner_id').notNull(),model:text('model').notNull(),worldId:text('world_id').notNull(),createdAt:text('created_at').notNull(),
});
// Pre-protocol tabs cannot prove inactivity. Legacy archives count toward quota
// but remain guarded until a separate explicit user-confirmed adoption flow.
export const retentionLegacyGuards=sqliteTable('retention_legacy_guards',{
  ownerId:text('owner_id').notNull(),model:text('model').notNull(),worldId:text('world_id').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.model,t.worldId]})]);
export const retentionAdoptions=sqliteTable('retention_adoptions',{
  token:text('token').primaryKey(),ownerId:text('owner_id').notNull(),model:text('model').notNull(),worldId:text('world_id').notNull(),
});
export const retentionNotices=sqliteTable('retention_notices',{
  ownerId:text('owner_id').notNull(),model:text('model').notNull(),worldId:text('world_id').notNull(),name:text('name').notNull(),bytes:integer('bytes'),deletedAt:text('deleted_at').notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.model,t.worldId]})]);
