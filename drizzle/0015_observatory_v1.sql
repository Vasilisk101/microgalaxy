CREATE TABLE `worlds_v1` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`seed` text NOT NULL,
	`starting_era` text NOT NULL,
	`schema_version` text NOT NULL,
	`model_version` text NOT NULL,
	`year` integer NOT NULL,
	`population` real NOT NULL,
	`era` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_key` text NOT NULL,
	`previous_snapshot_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `worlds_v1_owner_updated_idx` ON `worlds_v1` (`owner_id`,`updated_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_insert_guard BEFORE INSERT ON worlds_v1
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v1' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v1' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;

--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_update_guard BEFORE UPDATE ON worlds_v1
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v1' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v1' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;

--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_insert AFTER INSERT ON worlds_v1
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v1',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),0,0,NEW.updated_at);
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;

--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_update AFTER UPDATE ON worlds_v1
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at)
 SELECT OLD.previous_snapshot_key,OLD.owner_id,'v1',OLD.id,NEW.updated_at WHERE OLD.previous_snapshot_key IS NOT NULL AND OLD.previous_snapshot_key<>NEW.snapshot_key AND OLD.previous_snapshot_key<>COALESCE(NEW.previous_snapshot_key,'');
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v1',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),(SELECT current_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v1' AND world_id=OLD.id AND snapshot_key=OLD.snapshot_key),0,NEW.updated_at)
 ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at;
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;

--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_delete_guard BEFORE DELETE ON worlds_v1
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=OLD.owner_id AND model='v1' AND world_id=OLD.id)
 OR EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=OLD.owner_id AND model='v1' AND world_id=OLD.id)
 OR NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v1' AND world_id=OLD.id AND revision=OLD.revision AND snapshot_key=OLD.snapshot_key AND pinned=0 AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
 THEN RAISE(ABORT,'retention_protected') END;
END;

--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_delete AFTER DELETE ON worlds_v1
BEGIN
 INSERT OR IGNORE INTO retention_tombstones(owner_id,model,world_id,deleted_at) VALUES(OLD.owner_id,'v1',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) VALUES(OLD.snapshot_key,OLD.owner_id,'v1',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) SELECT OLD.previous_snapshot_key,OLD.owner_id,'v1',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE OLD.previous_snapshot_key IS NOT NULL;
 DELETE FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v1' AND world_id=OLD.id;
END;

--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_legacy_update BEFORE UPDATE ON worlds_v1
WHEN NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v1' AND world_id=OLD.id)
BEGIN
 INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(OLD.owner_id,'v1',OLD.id);
END;

--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_legacy_delete BEFORE DELETE ON worlds_v1
WHEN EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=OLD.owner_id AND model='v1' AND world_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'retention_legacy_protected');
END;

--> statement-breakpoint
CREATE TRIGGER retention_worlds_v1_notice BEFORE DELETE ON worlds_v1
BEGIN
 INSERT INTO retention_notices(owner_id,model,world_id,name,bytes,deleted_at) VALUES(OLD.owner_id,'v1',OLD.id,OLD.name,(SELECT current_bytes+previous_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v1' AND world_id=OLD.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 DELETE FROM retention_notices WHERE owner_id=OLD.owner_id AND rowid NOT IN(SELECT rowid FROM retention_notices WHERE owner_id=OLD.owner_id ORDER BY deleted_at DESC,rowid DESC LIMIT 50);
END;
