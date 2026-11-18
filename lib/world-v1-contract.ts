import * as engine from '../simulator-v1/src/core.mjs';
import {createArchiveCodec} from './world-archive-contract.ts';

export const codec = createArchiveCodec(engine, ['observatory']);
