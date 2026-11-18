-- Durable owner-scoped notices are part of the same deletion transaction.
CREATE TRIGGER retention_worlds_notice BEFORE DELETE ON worlds
BEGIN
 INSERT INTO retention_notices(owner_id,model,world_id,name,bytes,deleted_at) VALUES(OLD.owner_id,'classic',OLD.id,OLD.name,(SELECT current_bytes+previous_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='classic' AND world_id=OLD.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 DELETE FROM retention_notices WHERE owner_id=OLD.owner_id AND rowid NOT IN(SELECT rowid FROM retention_notices WHERE owner_id=OLD.owner_id ORDER BY deleted_at DESC,rowid DESC LIMIT 50);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v03_notice BEFORE DELETE ON worlds_v03
BEGIN
 INSERT INTO retention_notices(owner_id,model,world_id,name,bytes,deleted_at) VALUES(OLD.owner_id,'v03',OLD.id,OLD.name,(SELECT current_bytes+previous_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v03' AND world_id=OLD.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 DELETE FROM retention_notices WHERE owner_id=OLD.owner_id AND rowid NOT IN(SELECT rowid FROM retention_notices WHERE owner_id=OLD.owner_id ORDER BY deleted_at DESC,rowid DESC LIMIT 50);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v04_notice BEFORE DELETE ON worlds_v04
BEGIN
 INSERT INTO retention_notices(owner_id,model,world_id,name,bytes,deleted_at) VALUES(OLD.owner_id,'v04',OLD.id,OLD.name,(SELECT current_bytes+previous_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v04' AND world_id=OLD.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 DELETE FROM retention_notices WHERE owner_id=OLD.owner_id AND rowid NOT IN(SELECT rowid FROM retention_notices WHERE owner_id=OLD.owner_id ORDER BY deleted_at DESC,rowid DESC LIMIT 50);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v05_notice BEFORE DELETE ON worlds_v05
BEGIN
 INSERT INTO retention_notices(owner_id,model,world_id,name,bytes,deleted_at) VALUES(OLD.owner_id,'v05',OLD.id,OLD.name,(SELECT current_bytes+previous_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v05' AND world_id=OLD.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 DELETE FROM retention_notices WHERE owner_id=OLD.owner_id AND rowid NOT IN(SELECT rowid FROM retention_notices WHERE owner_id=OLD.owner_id ORDER BY deleted_at DESC,rowid DESC LIMIT 50);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v06_notice BEFORE DELETE ON worlds_v06
BEGIN
 INSERT INTO retention_notices(owner_id,model,world_id,name,bytes,deleted_at) VALUES(OLD.owner_id,'v06',OLD.id,OLD.name,(SELECT current_bytes+previous_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v06' AND world_id=OLD.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 DELETE FROM retention_notices WHERE owner_id=OLD.owner_id AND rowid NOT IN(SELECT rowid FROM retention_notices WHERE owner_id=OLD.owner_id ORDER BY deleted_at DESC,rowid DESC LIMIT 50);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v07_notice BEFORE DELETE ON worlds_v07
BEGIN
 INSERT INTO retention_notices(owner_id,model,world_id,name,bytes,deleted_at) VALUES(OLD.owner_id,'v07',OLD.id,OLD.name,(SELECT current_bytes+previous_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v07' AND world_id=OLD.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 DELETE FROM retention_notices WHERE owner_id=OLD.owner_id AND rowid NOT IN(SELECT rowid FROM retention_notices WHERE owner_id=OLD.owner_id ORDER BY deleted_at DESC,rowid DESC LIMIT 50);
END;
--> statement-breakpoint
CREATE TRIGGER retention_worlds_v08_notice BEFORE DELETE ON worlds_v08
BEGIN
 INSERT INTO retention_notices(owner_id,model,world_id,name,bytes,deleted_at) VALUES(OLD.owner_id,'v08',OLD.id,OLD.name,(SELECT current_bytes+previous_bytes FROM retention_entries WHERE owner_id=OLD.owner_id AND model='v08' AND world_id=OLD.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 DELETE FROM retention_notices WHERE owner_id=OLD.owner_id AND rowid NOT IN(SELECT rowid FROM retention_notices WHERE owner_id=OLD.owner_id ORDER BY deleted_at DESC,rowid DESC LIMIT 50);
END;
--> statement-breakpoint
