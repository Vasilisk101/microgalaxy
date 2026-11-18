import {createSimulation} from '../../simulator-v08/src/simulation.mjs';
import {edition} from './edition.mjs';

// Replay an original 1.0 seed with the simulation rules recorded at publication.
export const previousCore =
  createSimulation({...edition,version:'1.0.0',acceptsModelVersion:version=>version==='1.0.0'});
export const {MODEL_VERSION,SCHEMA,createWorld,advance,validateWorld,createWorkerSession} = previousCore;
