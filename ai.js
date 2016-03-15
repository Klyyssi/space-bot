"use strict";

var _ = require("lodash");
var position = require("../../position.js");

// Change botNames and teamName to your choice.
var botNames = [
  "Alpha",
  "Beta",
  "Gamma"
];

var MAP_SIZE = 14

var RADAR = function() {

  var overlapHistory = [];

  function hexGridOverlaps(hexCenter1, hexCenter2, hexWidth) {
    var distance = position.distance(hexCenter1, hexCenter2);
    return distance < hexWidth;
  }

  function radarsOverlap(radarLocation, currentRoundId) {
    var radarWidth = 5;

    var usedRadars = overlapHistory.filter(function(o) {
      return o.roundId === currentRoundId
    });

    return usedRadars.some(function(r) {
      return hexGridOverlaps(r.pos, radarLocation, radarWidth);
    });
  }

  function saveRadarLocation(radarLocation, currentRoundId) {
    overlapHistory.push({pos: radarLocation, roundId: currentRoundId});
  }

  return {
    radarsOverlap: radarsOverlap,
    saveRadarLocation: saveRadarLocation
  }
}();

var ENEMY_LOCATION_HISTORY = function() {
  var enemyLocationHistory = [];

  function saveEnemyLocation(enemyLocation, onRoundId) {
    enemyLocationHistory.push({pos: enemyLocation, round: onRoundId});
  }

  function getLatestEnemyTrackLocation() {
    return enemyLocationHistory[enemyLocationHistory.length - 1].pos;
  }

  function enemyLocationTrackIsMaxOfXRoundsOld(currentRoundId, roundLimit) {
    var historyIsEmpty = enemyLocationHistory.length === 0;

    if (!historyIsEmpty) {
      var enemyTrackRoundId = enemyLocationHistory[enemyLocationHistory.length - 1].round;
      var trackIsLessThanXRoundsOld = (currentRoundId - enemyTrackRoundId) <= roundLimit;
      return trackIsLessThanXRoundsOld;
    }

    return false;
  }

  return {
    saveLocation: saveEnemyLocation,
    getLatestLocationTrack: getLatestEnemyTrackLocation,
    latestTrackIsMaxOfXRoundsOld: enemyLocationTrackIsMaxOfXRoundsOld
  }
}();

var ACTIONS = function() {

  function useRadar(bot, location) {
    bot.radar(location.x, location.y);
  }

  function shootAtLocation(bot, location) {
    bot.cannon(location.x, location.y);
  }

  function moveToRandomNeighborLocation(bot, config) {
    var ps = position.neighbours(position.make(bot.x, bot.y), config.move);
    var pos = ps[HELPERS.randInt(0, ps.length - 1)];
    bot.move(pos.x, pos.y);
  }

  function escapeFrom(bot, location) {
    //TODO
  }

  return {
    useRadar: useRadar,
    shootAtLocation: shootAtLocation,
    moveToRandomNeighborLocation: moveToRandomNeighborLocation
  }
}();

var CANNON_HISTORY = function() {

  var locations = [];

  function getLatestShotLocation() {
    return locations[locations.length - 1];
  }

  function saveShotLocation(location) {
    locations.push(location);
  }

  return {
    getLatestShotLocation: getLatestShotLocation,
    saveShotLocation: saveShotLocation
  }
}();

var HELPERS = function() {

  function getMapLocationWithErrorMarginal(location, errorMarginal) {
    var xCoordWithError = randInt(Math.max(-MAP_SIZE, location.x - errorMarginal), Math.min(MAP_SIZE, location.x + errorMarginal));
    var yCoordWithError = randInt(Math.max(-MAP_SIZE, location.y - errorMarginal), Math.min(MAP_SIZE, location.y + errorMarginal));
    return {x: xCoordWithError, y: yCoordWithError};
  }

  function getRandomLocationOnMap() {
    // the sum of x+y must be between -MAP_SIZE and MAP_SIZE
    var xLoc = randInt(-MAP_SIZE, MAP_SIZE);
    var yLowerLimit = Math.max(-MAP_SIZE, -(xLoc + MAP_SIZE));
    var yUpperLimit = Math.min(MAP_SIZE, -(xLoc - MAP_SIZE));
    var yLoc = randInt(yLowerLimit, yUpperLimit);
    return {x: xLoc, y: yLoc};
  }

  function getRandomBoolean() {
    return Math.random() >= 0.5;
  }

  function randInt(min, max) {
    var range = max - min;
    var rand = Math.floor(Math.random() * (range + 1));
    return min + rand;
  }

  return {
    getMapLocationWithErrorMarginal: getMapLocationWithErrorMarginal,
    getRandomLocationOnMap: getRandomLocationOnMap,
    getRandomBoolean: getRandomBoolean,
    randInt: randInt
  }
}();

module.exports = function Ai() {

  var MSG_DETECTED = "detected";
  var MSG_RADARED = "radarEcho";
  var MSG_DAMAGED = "damaged";
  var MSG_SEEN = "see";
  var MSG_HIT = "hit";

  var playerIds;

  var predicateToFn =
      [
        {
          predicate: botHasBeenDetected,
          fn: function(gamestate) {
            ACTIONS.moveToRandomNeighborLocation(gamestate.bot, gamestate.config);
          }
        },
        {
          predicate: botHasBeenDamaged,
          fn: function(gamestate) {
            ACTIONS.moveToRandomNeighborLocation(gamestate.bot, gamestate.config);
          }
        },
        {
          predicate: enemyHasBeenDamaged,
          fn: function(gamestate) {
            var previousShootLocation = CANNON_HISTORY.getLatestShotLocation();
            var locationToShoot = HELPERS.getMapLocationWithErrorMarginal(previousShootLocation, 1);
            ACTIONS.shootAtLocation(gamestate.bot, locationToShoot);
            CANNON_HISTORY.saveShotLocation(locationToShoot);
          }
        },
        {
          predicate: enemyHasBeenRadared,
          fn: function(gamestate) {
            var enemyLocation = getRadaredEnemyLocation(gamestate.events);
            var shootLocation = HELPERS.getMapLocationWithErrorMarginal(enemyLocation, 1);
            ACTIONS.shootAtLocation(gamestate.bot, shootLocation);
            CANNON_HISTORY.saveShotLocation(shootLocation);
            ENEMY_LOCATION_HISTORY.saveLocation(enemyLocation, gamestate.roundId);
          }
        },
        {
          predicate: latestTrackOfEnemyIsMaxOf6RoundsOld,
          fn: function(gamestate) {
            var oldEnemyLocation = ENEMY_LOCATION_HISTORY.getLatestLocationTrack();
            var errorMarginal = 3;
            var locationToRadar = HELPERS.getMapLocationWithErrorMarginal(oldEnemyLocation, errorMarginal);
            while (RADAR.radarsOverlap(locationToRadar, gamestate.roundId)) {
              locationToRadar = HELPERS.getMapLocationWithErrorMarginal(locationToRadar, errorMarginal);
            }
            RADAR.saveRadarLocation(locationToRadar, gamestate.roundId);
            ACTIONS.useRadar(gamestate.bot, locationToRadar);
          }
        },
        { // this is the fallback function, use radar on random location if there was no events
          predicate: getTrue,
          fn: function(gamestate) {
            var randomLocation = HELPERS.getRandomLocationOnMap();
            while (RADAR.radarsOverlap(randomLocation, gamestate.roundId)) {
              randomLocation = HELPERS.getRandomLocationOnMap();
            }
            RADAR.saveRadarLocation(randomLocation, gamestate.roundId);
            ACTIONS.useRadar(gamestate.bot, randomLocation);
          }
        }
      ];

  function makeDecisions(roundId, events, bots, config) {
    if (isFirstRound) {
      playerIds = bots.map(function(b) { return b.botId; });
    }

    bots.forEach(function(bot) {
      doBestActionBasedOnEventsAndHistory({bot:bot, events:events, config:config, roundId:roundId, ownBotIds: playerIds});
    });

    warnIfBotActionsTookTooLongTime();
  }

  function doBestActionBasedOnEventsAndHistory(gamestate) {
    var action = giveBestActionBasedOnEventsAndHistory(gamestate);
    action(gamestate);
  }

  function giveBestActionBasedOnEventsAndHistory(gamestate) {
    return predicateToFn.filter(function(n) {
      return n.predicate(gamestate);
    })[0].fn;
  }

  function warnIfBotActionsTookTooLongTime(events) {
    _.each(events, function(event) {
      if (event.event === "noaction") {
        console.log("Bot did not respond in required time", event.data);
      }
    });
  }

  function getRadaredEnemyLocation(events) {
    return events
      .filter(function(e) { return e.event === MSG_RADARED; })
      .map(function(e) { return e.pos; })[0];
  }

  // PREDICATES ---

  function isFirstRound(currentRoundId) {
    return currentRoundId === 0;
  }

  function getTrue() {
    return true;
  }

  function latestTrackOfEnemyIsMaxOf6RoundsOld(gamestate) {
    return ENEMY_LOCATION_HISTORY.latestTrackIsMaxOfXRoundsOld(gamestate.roundId, 6);
  }

  function botIsNextToEnemy(gamestate) {
    return gamestate.events.some(function(e) { return e.event === MSG_SEEN && gamestate.bot.botId === e.botId; } );
  }

  function botHasBeenDamaged(gamestate) {
    return gamestate.events.some(function(e) { return e.event === MSG_DAMAGED && gamestate.bot.botId === e.botId; });
  }

  function botHasBeenDetected(gamestate) {
    return gamestate.events.some(function(e) { return e.event === MSG_DETECTED && gamestate.bot.botId === e.botId; });
  }

  function enemyHasBeenDamaged(gamestate) {
    return gamestate.events.some(function(e) { return e.event === MSG_HIT &&
      !gamestate.ownBotIds.some(function(b) { return e.botId === b; }); });
  }

  function enemyHasBeenRadared(gamestate) {
    return gamestate.events.some(function(e) { return e.event === MSG_RADARED; });
  }
  // PREDICATES ---

  return {
    // The AI must return these three attributes
    botNames: botNames,
    makeDecisions: makeDecisions
  };
};
