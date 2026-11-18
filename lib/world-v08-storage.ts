import {createArchiveStorage} from './world-archive-storage';
import {codec} from './world-v08-contract';
export {readV08MutationBody, v08Error, v08Response, v08RevisionFromPayload, v08WorldFromPayload} from './world-v08-contract';

export const {list: listV08Worlds, create: createV08World, read: readV08World, update: updateV08World} = createArchiveStorage('v08', codec);
