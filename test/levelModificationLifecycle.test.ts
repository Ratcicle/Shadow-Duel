import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Card from '../src/core/Card.js';
import { createPlanningCopy } from '../src/core/ai/common/planningCopy.js';
import { applySimulatedActions } from '../src/core/ai/common/simulatedActions/index.js';
import { cleanupSimulatedEndTurn } from '../src/core/ai/common/simulatedActions/lifecycle.js';
import { moveCardToZone } from '../src/core/ai/common/zones.js';
import { createCanonicalStateSnapshot } from '../src/core/game/replay/canonical.js';
import type { CardAction } from '../src/core/contracts/actions.js';
import { cardDefinition, required } from './helpers/fixtures.js';
import { createRuntimeGame, placeFieldCards } from './helpers/game.js';
import { simulationState } from './helpers/simulation.js';

function scenario(t: TestContext, actor: 'player'|'bot' = 'player') {
  const game = createRuntimeGame({ laboratoryMode:true, captureReplay:false, disableChains:true });
  t.after(()=>game.dispose('level_modification_lifecycle'));
  game.turn=actor; game.turnCounter=4; game.phase='main1'; game.disablePresentationDelays=true;
  game.player.controllerType='ai'; game.bot.controllerType='ai';
  const owner=game[actor], opponent=game[actor==='player'?'bot':'player'];
  const card=new Card(cardDefinition(503),actor); placeFieldCards(owner.field,card);
  const simulated=createPlanningCopy().cloneCardForSim(card);
  const state=simulationState({turn:actor,phase:'main1',turnCounter:4,[actor]:{field:[simulated]}});
  const apply=async(actions:readonly CardAction[])=>{
    await game.effectEngine.applyActions(actions,{source:card,player:owner,opponent},{chosen:[card]});
    applySimulatedActions({state,actions,selfId:actor,options:{sourceCard:simulated},selections:{chosen:[simulated]}});
  };
  return {game,owner,card,simulated,state,apply};
}

for(const actor of ['player','bot'] as const) {
  test(`durationless levels persist across End Phase until face-down (${actor})`,async t=>{
    const {game,owner,card,simulated,state,apply}=scenario(t,actor);
    await apply([{type:'modify_level',targetRef:'chosen',amount:1}]);
    game.cleanupTempBoosts(owner); cleanupSimulatedEndTurn(state);
    assert.equal(card.level,4,'durationless level changes must survive end-turn cleanup');
    assert.equal(simulated.level,4,'simulation must preserve the same presence change');
    await apply([{type:'set_facedown_defense',targetRef:'chosen'}]);
    assert.equal(card.level,3,'turning face-down ends the modified face-up presence');
    assert.equal(simulated.level,3);
  });
  test(`durationless levels do not return after field exit and re-entry (${actor})`,async t=>{
    const {game,owner,card,simulated,state,apply}=scenario(t,actor);
    await apply([{type:'modify_level',targetRef:'chosen',amount:2}]);
    await game.moveCard(card,owner,'graveyard',{fromZone:'field'});
    moveCardToZone(state[actor],simulated,'graveyard',state[actor],{state});
    assert.equal(card.level,3);assert.equal(simulated.level,3);
    await game.moveCard(card,owner,'field',{fromZone:'graveyard',position:'attack',summonMethodOverride:'special',summonOrigin:'effect_resolution'});
    moveCardToZone(state[actor],simulated,'field',state[actor],{state});
    assert.equal(card.level,3);assert.equal(simulated.level,3);
  });
}

for(const temporaryFirst of [false,true])test(`independent level contributions expire separately; temporaryFirst=${temporaryFirst}`,async t=>{
  const {game,owner,card,simulated,state,apply}=scenario(t);
  const lasting={type:'modify_level',targetRef:'chosen',amount:1} as const;
  const temporary={type:'modify_level',targetRef:'chosen',amount:2,duration:'until_end_turn'} as const;
  await apply(temporaryFirst?[temporary,lasting]:[lasting,temporary]);
  assert.equal(card.level,6);assert.equal(simulated.level,6);
  game.cleanupTempBoosts(owner);cleanupSimulatedEndTurn(state);
  assert.equal(card.level,4,'only the explicit turn contribution expires');assert.equal(simulated.level,4);
  await apply([{type:'set_facedown_defense',targetRef:'chosen'}]);
  assert.equal(card.level,3);assert.equal(simulated.level,3);
});

test('explicit turn durations, permanent levels and legacy hand baselines keep their behavior',async t=>{
  const {game,owner,card,simulated,state,apply}=scenario(t);
  await apply([{type:'modify_level',targetRef:'chosen',amount:2,duration:'until_end_turn'}]);
  game.cleanupTempBoosts(owner);cleanupSimulatedEndTurn(state);assert.equal(card.level,3);assert.equal(simulated.level,3);
  await apply([{type:'modify_level',targetRef:'chosen',amount:2,duration:'permanent'}]);
  game.cleanupTempBoosts(owner);cleanupSimulatedEndTurn(state);assert.equal(card.level,5);assert.equal(simulated.level,5);
  await game.moveCard(card,owner,'graveyard',{fromZone:'field'});moveCardToZone(state.player,simulated,'graveyard',state.player,{state});
  assert.equal(card.level,5);assert.equal(simulated.level,5);
  const hand=new Card(cardDefinition(503),'player');hand.originalLevel=3;hand.level=1;owner.hand.push(hand);
  game.cleanupTempBoosts(owner);assert.equal(hand.level,3);assert.equal(hand.originalLevel,null);
});

test('level expiry metadata survives independent planning copies, snapshots and canonical serialization',async t=>{
  const {game,card,apply}=scenario(t);
  await apply([{type:'modify_level',targetRef:'chosen',amount:1}]);
  const contributions=Reflect.get(card,'levelModificationContributions');
  assert.deepEqual(contributions,[{amount:1,duration:'while_faceup'}]);
  const copy=createPlanningCopy().cloneCardForSim(card);
  assert.deepEqual(Reflect.get(copy,'levelModificationContributions'),contributions);
  assert.notEqual(Reflect.get(copy,'levelModificationContributions'),contributions);
  const snapshot=required(game.snapshotCardState(card));
  assert.deepEqual(Reflect.get(snapshot,'levelModificationContributions'),contributions);
  assert.notEqual(Reflect.get(snapshot,'levelModificationContributions'),contributions);
  const canonical=required(createCanonicalStateSnapshot(game).players.player.zones.field[0]);
  assert.equal(Reflect.get(canonical,'originalLevel'),3);
  assert.deepEqual(Reflect.get(canonical,'levelModificationContributions'),contributions);
});
