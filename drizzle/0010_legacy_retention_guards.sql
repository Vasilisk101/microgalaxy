-- Guard old cloud records, including already-open pre-protocol clients.
CREATE TRIGGER retention_worlds_legacy_update BEFORE UPDATE ON worlds
WHEN NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='classic' AND world_id=OLD.id)
BEGIN
 INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(OLD.owner_id,'classic',OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_legacy_delete BEFORE DELETE ON worlds
WHEN EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=OLD.owner_id AND model='classic' AND world_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'retention_legacy_protected');
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_legacy_update BEFORE UPDATE ON worlds_v03
WHEN NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v03' AND world_id=OLD.id)
BEGIN
 INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(OLD.owner_id,'v03',OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_legacy_delete BEFORE DELETE ON worlds_v03
WHEN EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=OLD.owner_id AND model='v03' AND world_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'retention_legacy_protected');
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_legacy_update BEFORE UPDATE ON worlds_v04
WHEN NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v04' AND world_id=OLD.id)
BEGIN
 INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(OLD.owner_id,'v04',OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_legacy_delete BEFORE DELETE ON worlds_v04
WHEN EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=OLD.owner_id AND model='v04' AND world_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'retention_legacy_protected');
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_legacy_update BEFORE UPDATE ON worlds_v05
WHEN NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v05' AND world_id=OLD.id)
BEGIN
 INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(OLD.owner_id,'v05',OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_legacy_delete BEFORE DELETE ON worlds_v05
WHEN EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=OLD.owner_id AND model='v05' AND world_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'retention_legacy_protected');
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_legacy_update BEFORE UPDATE ON worlds_v06
WHEN NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v06' AND world_id=OLD.id)
BEGIN
 INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(OLD.owner_id,'v06',OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_legacy_delete BEFORE DELETE ON worlds_v06
WHEN EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=OLD.owner_id AND model='v06' AND world_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'retention_legacy_protected');
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_legacy_update BEFORE UPDATE ON worlds_v07
WHEN NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v07' AND world_id=OLD.id)
BEGIN
 INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(OLD.owner_id,'v07',OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_legacy_delete BEFORE DELETE ON worlds_v07
WHEN EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=OLD.owner_id AND model='v07' AND world_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'retention_legacy_protected');
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_legacy_update BEFORE UPDATE ON worlds_v08
WHEN NOT EXISTS(SELECT 1 FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v08' AND world_id=OLD.id)
BEGIN
 INSERT OR IGNORE INTO retention_legacy_guards(owner_id,model,world_id) VALUES(OLD.owner_id,'v08',OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_legacy_delete BEFORE DELETE ON worlds_v08
WHEN EXISTS(SELECT 1 FROM retention_legacy_guards WHERE owner_id=OLD.owner_id AND model='v08' AND world_id=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'retention_legacy_protected');
END;
--> statement-breakpoint
