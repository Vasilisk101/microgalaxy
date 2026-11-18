-- Coordination is storage metadata only; no simulation state is transformed.
CREATE TRIGGER retention_worlds_insert_guard BEFORE INSERT ON worlds
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='classic' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='classic' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_update_guard BEFORE UPDATE ON worlds
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='classic' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='classic' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_insert AFTER INSERT ON worlds
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'classic',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),0,0,NEW.updated_at);
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_update AFTER UPDATE ON worlds
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at)
 SELECT OLD.previous_snapshot_key,OLD.owner_id,'classic',OLD.id,NEW.updated_at WHERE OLD.previous_snapshot_key IS NOT NULL AND OLD.previous_snapshot_key<>NEW.snapshot_key AND OLD.previous_snapshot_key<>COALESCE(NEW.previous_snapshot_key,'');
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'classic',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),(SELECT current_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='classic' AND world_id=OLD.id AND snapshot_key=OLD.snapshot_key),0,NEW.updated_at)
 ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at;
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_delete_guard BEFORE DELETE ON worlds
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=OLD.owner_id AND model='classic' AND world_id=OLD.id)
 OR EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=OLD.owner_id AND model='classic' AND world_id=OLD.id)
 OR NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='classic' AND world_id=OLD.id AND revision=OLD.revision AND snapshot_key=OLD.snapshot_key AND pinned=0 AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
 THEN RAISE(ABORT,'retention_protected') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_delete AFTER DELETE ON worlds
BEGIN
 INSERT OR IGNORE INTO retention_tombstones(owner_id,model,world_id,deleted_at) VALUES(OLD.owner_id,'classic',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) VALUES(OLD.snapshot_key,OLD.owner_id,'classic',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) SELECT OLD.previous_snapshot_key,OLD.owner_id,'classic',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE OLD.previous_snapshot_key IS NOT NULL;
 DELETE FROM retention_entries WHERE owner_id=OLD.owner_id AND model='classic' AND world_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_insert_guard BEFORE INSERT ON worlds_v03
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v03' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v03' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_update_guard BEFORE UPDATE ON worlds_v03
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v03' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v03' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_insert AFTER INSERT ON worlds_v03
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v03',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),0,0,NEW.updated_at);
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_update AFTER UPDATE ON worlds_v03
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at)
 SELECT OLD.previous_snapshot_key,OLD.owner_id,'v03',OLD.id,NEW.updated_at WHERE OLD.previous_snapshot_key IS NOT NULL AND OLD.previous_snapshot_key<>NEW.snapshot_key AND OLD.previous_snapshot_key<>COALESCE(NEW.previous_snapshot_key,'');
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v03',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),(SELECT current_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v03' AND world_id=OLD.id AND snapshot_key=OLD.snapshot_key),0,NEW.updated_at)
 ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at;
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_delete_guard BEFORE DELETE ON worlds_v03
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=OLD.owner_id AND model='v03' AND world_id=OLD.id)
 OR EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=OLD.owner_id AND model='v03' AND world_id=OLD.id)
 OR NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v03' AND world_id=OLD.id AND revision=OLD.revision AND snapshot_key=OLD.snapshot_key AND pinned=0 AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
 THEN RAISE(ABORT,'retention_protected') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_delete AFTER DELETE ON worlds_v03
BEGIN
 INSERT OR IGNORE INTO retention_tombstones(owner_id,model,world_id,deleted_at) VALUES(OLD.owner_id,'v03',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) VALUES(OLD.snapshot_key,OLD.owner_id,'v03',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) SELECT OLD.previous_snapshot_key,OLD.owner_id,'v03',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE OLD.previous_snapshot_key IS NOT NULL;
 DELETE FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v03' AND world_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_insert_guard BEFORE INSERT ON worlds_v04
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v04' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v04' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_update_guard BEFORE UPDATE ON worlds_v04
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v04' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v04' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_insert AFTER INSERT ON worlds_v04
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v04',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),0,0,NEW.updated_at);
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_update AFTER UPDATE ON worlds_v04
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at)
 SELECT OLD.previous_snapshot_key,OLD.owner_id,'v04',OLD.id,NEW.updated_at WHERE OLD.previous_snapshot_key IS NOT NULL AND OLD.previous_snapshot_key<>NEW.snapshot_key AND OLD.previous_snapshot_key<>COALESCE(NEW.previous_snapshot_key,'');
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v04',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),(SELECT current_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v04' AND world_id=OLD.id AND snapshot_key=OLD.snapshot_key),0,NEW.updated_at)
 ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at;
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_delete_guard BEFORE DELETE ON worlds_v04
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=OLD.owner_id AND model='v04' AND world_id=OLD.id)
 OR EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=OLD.owner_id AND model='v04' AND world_id=OLD.id)
 OR NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v04' AND world_id=OLD.id AND revision=OLD.revision AND snapshot_key=OLD.snapshot_key AND pinned=0 AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
 THEN RAISE(ABORT,'retention_protected') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_delete AFTER DELETE ON worlds_v04
BEGIN
 INSERT OR IGNORE INTO retention_tombstones(owner_id,model,world_id,deleted_at) VALUES(OLD.owner_id,'v04',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) VALUES(OLD.snapshot_key,OLD.owner_id,'v04',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) SELECT OLD.previous_snapshot_key,OLD.owner_id,'v04',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE OLD.previous_snapshot_key IS NOT NULL;
 DELETE FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v04' AND world_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_insert_guard BEFORE INSERT ON worlds_v05
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v05' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v05' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_update_guard BEFORE UPDATE ON worlds_v05
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v05' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v05' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_insert AFTER INSERT ON worlds_v05
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v05',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),0,0,NEW.updated_at);
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_update AFTER UPDATE ON worlds_v05
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at)
 SELECT OLD.previous_snapshot_key,OLD.owner_id,'v05',OLD.id,NEW.updated_at WHERE OLD.previous_snapshot_key IS NOT NULL AND OLD.previous_snapshot_key<>NEW.snapshot_key AND OLD.previous_snapshot_key<>COALESCE(NEW.previous_snapshot_key,'');
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v05',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),(SELECT current_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v05' AND world_id=OLD.id AND snapshot_key=OLD.snapshot_key),0,NEW.updated_at)
 ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at;
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_delete_guard BEFORE DELETE ON worlds_v05
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=OLD.owner_id AND model='v05' AND world_id=OLD.id)
 OR EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=OLD.owner_id AND model='v05' AND world_id=OLD.id)
 OR NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v05' AND world_id=OLD.id AND revision=OLD.revision AND snapshot_key=OLD.snapshot_key AND pinned=0 AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
 THEN RAISE(ABORT,'retention_protected') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_delete AFTER DELETE ON worlds_v05
BEGIN
 INSERT OR IGNORE INTO retention_tombstones(owner_id,model,world_id,deleted_at) VALUES(OLD.owner_id,'v05',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) VALUES(OLD.snapshot_key,OLD.owner_id,'v05',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) SELECT OLD.previous_snapshot_key,OLD.owner_id,'v05',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE OLD.previous_snapshot_key IS NOT NULL;
 DELETE FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v05' AND world_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_insert_guard BEFORE INSERT ON worlds_v06
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v06' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v06' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_update_guard BEFORE UPDATE ON worlds_v06
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v06' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v06' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_insert AFTER INSERT ON worlds_v06
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v06',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),0,0,NEW.updated_at);
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_update AFTER UPDATE ON worlds_v06
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at)
 SELECT OLD.previous_snapshot_key,OLD.owner_id,'v06',OLD.id,NEW.updated_at WHERE OLD.previous_snapshot_key IS NOT NULL AND OLD.previous_snapshot_key<>NEW.snapshot_key AND OLD.previous_snapshot_key<>COALESCE(NEW.previous_snapshot_key,'');
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v06',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),(SELECT current_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v06' AND world_id=OLD.id AND snapshot_key=OLD.snapshot_key),0,NEW.updated_at)
 ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at;
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_delete_guard BEFORE DELETE ON worlds_v06
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=OLD.owner_id AND model='v06' AND world_id=OLD.id)
 OR EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=OLD.owner_id AND model='v06' AND world_id=OLD.id)
 OR NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v06' AND world_id=OLD.id AND revision=OLD.revision AND snapshot_key=OLD.snapshot_key AND pinned=0 AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
 THEN RAISE(ABORT,'retention_protected') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_delete AFTER DELETE ON worlds_v06
BEGIN
 INSERT OR IGNORE INTO retention_tombstones(owner_id,model,world_id,deleted_at) VALUES(OLD.owner_id,'v06',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) VALUES(OLD.snapshot_key,OLD.owner_id,'v06',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) SELECT OLD.previous_snapshot_key,OLD.owner_id,'v06',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE OLD.previous_snapshot_key IS NOT NULL;
 DELETE FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v06' AND world_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_insert_guard BEFORE INSERT ON worlds_v07
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v07' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v07' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_update_guard BEFORE UPDATE ON worlds_v07
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v07' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v07' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_insert AFTER INSERT ON worlds_v07
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v07',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),0,0,NEW.updated_at);
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_update AFTER UPDATE ON worlds_v07
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at)
 SELECT OLD.previous_snapshot_key,OLD.owner_id,'v07',OLD.id,NEW.updated_at WHERE OLD.previous_snapshot_key IS NOT NULL AND OLD.previous_snapshot_key<>NEW.snapshot_key AND OLD.previous_snapshot_key<>COALESCE(NEW.previous_snapshot_key,'');
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v07',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),(SELECT current_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v07' AND world_id=OLD.id AND snapshot_key=OLD.snapshot_key),0,NEW.updated_at)
 ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at;
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_delete_guard BEFORE DELETE ON worlds_v07
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=OLD.owner_id AND model='v07' AND world_id=OLD.id)
 OR EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=OLD.owner_id AND model='v07' AND world_id=OLD.id)
 OR NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v07' AND world_id=OLD.id AND revision=OLD.revision AND snapshot_key=OLD.snapshot_key AND pinned=0 AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
 THEN RAISE(ABORT,'retention_protected') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_delete AFTER DELETE ON worlds_v07
BEGIN
 INSERT OR IGNORE INTO retention_tombstones(owner_id,model,world_id,deleted_at) VALUES(OLD.owner_id,'v07',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) VALUES(OLD.snapshot_key,OLD.owner_id,'v07',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) SELECT OLD.previous_snapshot_key,OLD.owner_id,'v07',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE OLD.previous_snapshot_key IS NOT NULL;
 DELETE FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v07' AND world_id=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_insert_guard BEFORE INSERT ON worlds_v08
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v08' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v08' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_update_guard BEFORE UPDATE ON worlds_v08
WHEN EXISTS(SELECT 1 FROM retention_settings WHERE owner_id=NEW.owner_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_tombstones WHERE owner_id=NEW.owner_id AND model='v08' AND world_id=NEW.id) THEN RAISE(ABORT,'retention_tombstone') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=NEW.owner_id AND model='v08' AND world_id=NEW.id AND snapshot_key=NEW.snapshot_key) THEN RAISE(ABORT,'retention_protocol_required') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_insert AFTER INSERT ON worlds_v08
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v08',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),0,0,NEW.updated_at);
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_update AFTER UPDATE ON worlds_v08
WHEN EXISTS(SELECT 1 FROM retention_intents WHERE snapshot_key=NEW.snapshot_key)
BEGIN
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at)
 SELECT OLD.previous_snapshot_key,OLD.owner_id,'v08',OLD.id,NEW.updated_at WHERE OLD.previous_snapshot_key IS NOT NULL AND OLD.previous_snapshot_key<>NEW.snapshot_key AND OLD.previous_snapshot_key<>COALESCE(NEW.previous_snapshot_key,'');
 INSERT INTO retention_entries(owner_id,model,world_id,revision,snapshot_key,previous_snapshot_key,current_bytes,previous_bytes,pinned,updated_at)
 VALUES(NEW.owner_id,'v08',NEW.id,NEW.revision,NEW.snapshot_key,NEW.previous_snapshot_key,(SELECT bytes FROM retention_intents WHERE snapshot_key=NEW.snapshot_key),(SELECT current_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v08' AND world_id=OLD.id AND snapshot_key=OLD.snapshot_key),0,NEW.updated_at)
 ON CONFLICT(owner_id,model,world_id) DO UPDATE SET revision=excluded.revision,snapshot_key=excluded.snapshot_key,previous_snapshot_key=excluded.previous_snapshot_key,current_bytes=excluded.current_bytes,previous_bytes=excluded.previous_bytes,updated_at=excluded.updated_at;
 DELETE FROM retention_intents WHERE snapshot_key=NEW.snapshot_key;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_delete_guard BEFORE DELETE ON worlds_v08
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM retention_leases WHERE owner_id=OLD.owner_id AND model='v08' AND world_id=OLD.id)
 OR EXISTS(SELECT 1 FROM retention_intents WHERE owner_id=OLD.owner_id AND model='v08' AND world_id=OLD.id)
 OR NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v08' AND world_id=OLD.id AND revision=OLD.revision AND snapshot_key=OLD.snapshot_key AND pinned=0 AND current_bytes IS NOT NULL AND previous_bytes IS NOT NULL)
 THEN RAISE(ABORT,'retention_protected') END;
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_delete AFTER DELETE ON worlds_v08
BEGIN
 INSERT OR IGNORE INTO retention_tombstones(owner_id,model,world_id,deleted_at) VALUES(OLD.owner_id,'v08',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) VALUES(OLD.snapshot_key,OLD.owner_id,'v08',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT OR IGNORE INTO retention_garbage(snapshot_key,owner_id,model,world_id,created_at) SELECT OLD.previous_snapshot_key,OLD.owner_id,'v08',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE OLD.previous_snapshot_key IS NOT NULL;
 DELETE FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v08' AND world_id=OLD.id;
END;
--> statement-breakpoint
