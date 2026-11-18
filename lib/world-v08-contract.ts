import * as engine from '../simulator-v08/src/core.mjs';
import {createArchiveCodec} from './world-archive-contract.ts';

export {
  MAX_SNAPSHOT_BYTES as MAX_V08_SNAPSHOT_BYTES, PAGE_SIZE as V08_PAGE_SIZE,
  ArchiveStorageError as V08StorageError, assertArchiveId as assertV08Id,
  assertArchiveUpdate as assertV08Update, archiveResponse as v08Response, archiveError as v08Error,
  revisionFromPayload as v08RevisionFromPayload, readMutationBody as readV08MutationBody,
  encodeCursor as encodeV08Cursor, decodeCursor as decodeV08Cursor, snapshotContent as v08SnapshotContent,
  type ArchiveWorld as V08World, type ArchiveIdentity as V08Identity, type ArchiveCursor as V08Cursor,
} from './world-archive-contract.ts';

export const codec = createArchiveCodec(engine);
export const {
  validate: validateV08World, metrics: v08WorldMetrics,
  worldFromPayload: v08WorldFromPayload, parseSnapshot: parseV08Snapshot,
} = codec;
