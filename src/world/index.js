'use strict';
/** The world: map, economy, events, politics, diplomacy and war. See each module for details. */
module.exports = {
  geo: require('./geo'),
  defaults: require('./defaults'),
  state: require('./state'),
  common: require('./common'),
  economy: require('./economy'),
  events: require('./events'),
  politics: require('./politics'),
  diplomacy: require('./diplomacy'),
  military: require('./military'),
  power: require('./power'),
  tick: require('./tick'),
};
