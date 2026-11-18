import {createSimulation} from '../../simulator-v08/src/simulation.mjs';
import {edition} from './edition.mjs';

export const {
  MODEL_VERSION, acceptsModelVersion, SCHEMA, LIMITS, COLORS, GOVERNMENTS, TECH_NAMES, FACTIONS, POLICIES, clamp, clone, hash, rand, terrain, distance, allEvents, allMissions, eventPage, eventCount, eventPageCount, geographySummary, economySummary, conflictSummary, regionSummary, routeBetweenRegions, createWorld, totalPopulation, knowledgeSummary, societyDevelopmentSummary, epoch, summary, politicsSummary, diplomacySummary, eventThread, storylines, viewSnapshot, isObservedEvent, advance, createWorkerSession, applyWorkerPatch, validateWorld
} = createSimulation(edition);
