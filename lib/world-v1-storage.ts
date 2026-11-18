import {createArchiveStorage} from './world-archive-storage';
import {codec} from './world-v1-contract';
export {archiveResponse, archiveError, readMutationBody, revisionFromPayload} from './world-archive-contract.ts';

export const {worldFromPayload} = codec;
export const {list, create, read, update} = createArchiveStorage('v1', codec);
