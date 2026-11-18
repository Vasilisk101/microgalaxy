import * as LivingWorld from './living-world.mjs';
import * as SpaceWorld from './space-world.mjs';

import * as Branches from './branches.mjs';
import * as Economy from '../../simulator-v08/src/economy.mjs';

export const edition = {
  version: '1.0.1',
  acceptsModelVersion: version => version==='1.0.0' || version==='1.0.1',
  schema: 'microgalaxy.observatory/1',
  generateBodies: SpaceWorld.generateBodies,
  initialize(world) {
    world.observatory = {};
    LivingWorld.initialize(world);
    SpaceWorld.initialize(world);
  },
  beforeYear: LivingWorld.beforeYear,
  beforeSpace(world) {SpaceWorld.beforeSpace(world, Economy.importSupply);},
  afterYear(world) {
    LivingWorld.afterYear(world);
    SpaceWorld.afterSpace(world);
  },
  found(world,colony,mission) {SpaceWorld.found(world,colony,mission);},
  probeArrived: SpaceWorld.probeArrived,
  waitingForProbe(world,owner,target) {
    return world.observatory.space.messages.some(m=>!m.delivered && m.payload.kind==='probe-result' && m.payload.owner===owner && m.payload.target===target);
  },
  foodOutput: SpaceWorld.localFoodOutput,
  targets(world,origin,engineering) {
    const reachable = SpaceWorld.targetOptions(world,origin,engineering)
      .filter(target=>target.suitable && target.reachable && target.window);
    return new Map(reachable.map(target=>[target.id,target]));
  },
  supplyRoute(world,colony,home,society) {
    const target = this.targets(world,home.id,society.tech[1]).get(colony.planet);
    return target;
  },
  validate(world) {
    LivingWorld.validate(world);
    SpaceWorld.validate(world);
    Branches.validate(world);
  }
};
