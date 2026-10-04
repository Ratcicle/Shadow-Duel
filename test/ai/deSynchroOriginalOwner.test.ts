import assert from 'node:assert/strict';
import test from 'node:test';
import type {GameCard} from '../../src/core/contracts/cards.js';
import type {ReplayDriverGamePort} from '../../src/core/contracts/replay.js';
import {createCanonicalStateSnapshot,validateCanonicalReplay} from '../../src/core/game/replay/canonical.js';
import {replayCanonicalDuel} from '../../src/core/game/replay/driver.js';
import {cloneBotGameState,type BotCloneGamePort} from '../../src/core/bot/simulationBridge.js';
import {applyGenericSimulatedMainPhaseAction} from '../../src/core/ai/common/simulation.js';
import {setLocale} from '../../src/core/i18n.js';
import {required,unsafeFixture} from '../helpers/fixtures.js';
import {createRuntimeGame,placeFieldCards,type RuntimeGame} from '../helpers/game.js';

type Seat='player'|'bot';
type Mode='accept'|'decline'|'missing-exact'|'no-transfer';
function install(game:RuntimeGame,seat:Seat){
 const start=game.startWithDecks.bind(game);
 game.startWithDecks=async options=>{
  await start(options);const actor=game[seat],other=game[seat==='player'?'bot':'player'];
  game.turn=other.id;game.phase='main1';game.turnCounter=3;game.phaseDelayMs=0;
  game.player.controllerType=game.bot.controllerType='human';game.disablePresentationDelays=true;
  game.waitForBoardPresentation=game.waitForPresentationDelay=game.waitForAiPresentationStep=async()=>{};
  for(const p of [actor,other])p.deck.push(...p.hand.splice(0));
  const take=(p:typeof actor,id:number)=>{const c=required(p.deck.find(c=>c.id===id));p.deck.splice(p.deck.indexOf(c),1);return c;};
  actor.hand.push(take(actor,19),take(actor,8));
  // Initial main-deck field/GY fixture; neither Synchro nor control is fabricated.
  placeFieldCards(actor.field,take(actor,508),take(actor,1));
  actor.graveyard.push(take(actor,508));
  placeFieldCards(other.field,take(other,551),take(other,1));
  for(const c of [...actor.field,...other.field]){c.isFacedown=false;c.position='attack';c.summonedTurn=1;game.effectEngine.assignFieldPresenceId(c);}
 };
}
async function drive(game:RuntimeGame,promise:Promise<unknown>,pick:(id:string)=>GameCard){
 let done=false,error:unknown;const settled=promise.then(()=>{done=true;},e=>{done=true;error=e;});
 const tasks=new Set<Promise<void>>(),seen=new Set<object>();
 for(let tick=0;tick<5000;tick++){
  const s=game.targetSelection;if(s&&!seen.has(s)){seen.add(s);for(const r of s.requirements)s.selections[r.id]=[required(r.candidates.find(c=>c.cardRef===pick(r.id))).key];
   const task=game.finishTargetSelection();tasks.add(task);void task.then(()=>tasks.delete(task),e=>{error=e;tasks.delete(task);});}
  if(done&&!game.targetSelection&&!tasks.size)break;await new Promise(r=>setTimeout(r,1));
 }
 assert.ok(done&&!game.targetSelection&&!tasks.size,'decisions settle');await settled;if(error)throw error;return promise;
}
for(const seat of ['player','bot']as const)for(const mode of ['accept','decline','missing-exact','no-transfer']as const)test(`De-Synchro after real control transfer ${seat}/${mode}`,{timeout:30000},async t=>{
 setLocale('en');
 const game=createRuntimeGame({laboratoryMode:true,laboratoryUseBot:false,captureReplay:true,randomSeed:4051,chainResponseTimeoutMs:0});
 const playback=createRuntimeGame({laboratoryMode:true,laboratoryUseBot:false,captureReplay:false,replayMode:'playback',chainResponseTimeoutMs:0});
 t.after(()=>{game.dispose();playback.dispose();setLocale('en');});install(game,seat);install(playback,seat);
 const prompts:Array<{message:string;effectId:unknown;accepted:boolean}>=[],moves:unknown[]=[],summons:unknown[]=[],controls:unknown[]=[],positions:Array<number|string>=[];
 game.ui.showConfirmPrompt=async(message,options)=>{const revive=String(message).startsWith('Special Summon the Synchro Materials');const control=Reflect.get(options || {}, 'effectId')==='cursed_rock_behemoth_battle_control';const accepted=control?mode!=='no-transfer':revive?mode!=='decline':false;prompts.push({message:String(message),effectId:Reflect.get(options || {}, 'effectId')??null,accepted});return accepted;};
 game.ui.showChainResponseModal=async()=>null;
 game.ui.showTriggerOrderModal=async(options)=>options?.optional?[]:(options?.candidates || []).map(candidate => candidate.candidateId);
 game.ui.showSpecialSummonPositionModal=(card,choose)=>{positions.push(required(card?.id));choose(card?.id===29||card?.id===31?'attack':'defense');};
 game.autoSelector.select=()=>assert.fail('human decisions cannot use AI');
 const deck=[19,8,508,508,551,1,1,1,3,3,3,4,4,4,7,7,7,9,9,9];
 const otherSeat=seat==='player'?'bot':'player';
 await game.startWithDecks({exactDecks:true,preserveDeckOrder:true,initializeOnly:true,startAtDrawPhase:true,startingPlayer:otherSeat,announceStartingPlayer:false,playerDeck:deck,botDeck:deck,playerExtraDeck:[29,31],botExtraDeck:[29,31]});
 const actor=game[seat],other=game[otherSeat],tuner=required(actor.field[0]),material=required(actor.field[1]),decoy=required(actor.graveyard[0]),earth=required(other.field[0]),earthMate=required(other.field[1]);
 const synchro=required(actor.extraDeck.find(c=>c.id===31)),behemoth=required(other.extraDeck.find(c=>c.id===29)),spell=required(actor.hand.find(c=>c.id===19)),reborn=required(actor.hand.find(c=>c.id===8));
 const identity=(card:GameCard)=>({id:card.id,instance:card.instanceId,duel:game.ensureDuelCardId(card),presence:card.fieldPresenceId,location:card.locationVersion,owner:card.owner,controller:card.controller,originalOwner:card.originalOwner});
 game.on('card_moved',e=>moves.push({card:{id:e.card.id,instance:e.card.instanceId,owner:e.card.owner,originalOwner:e.card.originalOwner},from:e.fromZone,to:e.toZone,context:e.contextLabel??null,turn:game.turnCounter}));
 game.on('after_summon',e=>summons.push({card:{id:e.card.id,instance:e.card.instanceId,owner:e.card.owner,originalOwner:e.card.originalOwner},method:e.method,from:e.fromZone,procedure:e.card.lastSummonProcedure}));
 game.on('control_changed',e=>controls.push({card:{id:e.card.id,instance:e.card.instanceId,owner:e.card.owner,originalOwner:e.card.originalOwner},from:e.previousControllerId,to:e.controllerId,reason:e.reason}));
 const choose=(id:string)=>{if(id==='cursed_rock_behemoth_destroyer'||id==='de_synchro_target')return synchro;if(id==='reborn_target')return tuner;throw new Error('unexpected selection '+id);};
 assert.equal(game.canSummonSynchroCard(other,behemoth,{checkActionWindow:true}).ok,true);
 assert.equal((await game.performSynchroSummonFromExtraDeck(behemoth,other,{materials:[earth,earthMate]})).success,true);
 assert.ok(other.field.includes(behemoth));assert.equal(behemoth.lastSummonProcedure,'synchro');
 for(const phase of ['battle','main2','end','main1']){await drive(game,game.nextPhase(),choose);assert.equal(game.phase,phase);}
 assert.equal(game.turn,actor.id);assert.equal(game.turnCounter,4);
 assert.equal(game.canSummonSynchroCard(actor,synchro,{checkActionWindow:true}).ok,true);
 assert.equal((await game.performSynchroSummonFromExtraDeck(synchro,actor,{materials:[tuner,material]})).success,true);
 assert.deepEqual(synchro.synchroMaterials?.map(m=>m.instanceId),[tuner.instanceId,material.instanceId]);
 assert.equal(synchro.lastSummonProcedure,'synchro');assert.equal(synchro.lastSummonedFromZone,'extraDeck');const summoned=identity(synchro);
 await drive(game,game.nextPhase(),choose);assert.equal(game.phase,'battle');
 assert.equal(game.getAttackAvailability(synchro).ok,true,JSON.stringify(game.getAttackAvailability(synchro)));await drive(game,game.resolveCombat(synchro,behemoth),choose);
 const stolen=mode!=='no-transfer';assert.equal(synchro.owner,stolen?other.id:actor.id);assert.equal(synchro.originalOwner,actor.id);
 assert.equal(synchro.fieldPresenceId,summoned.presence);assert.equal(synchro.locationVersion,summoned.location);
 assert.equal(controls.length,stolen?1:0);assert.ok(other.graveyard.includes(behemoth));assert.equal(behemoth.lastSummonProcedure,'synchro');
 assert.ok(actor.graveyard.includes(tuner)&&actor.graveyard.includes(material)&&actor.graveyard.includes(decoy));
 assert.equal(tuner.id,decoy.id);assert.notEqual(tuner.instanceId,decoy.instanceId);
 await drive(game,game.nextPhase(),choose);assert.equal(game.phase,'main2');
 if(mode==='missing-exact'){const activation=game.tryActivateSpell(reborn,actor.hand.indexOf(reborn),null,{owner:actor});await drive(game,activation,choose);assert.equal((await activation).success,true);assert.ok(actor.field.includes(tuner));assert.ok(actor.graveyard.includes(decoy));}
 const before={synchro:identity(synchro),metadata:synchro.synchroMaterials,actorField:actor.field.map(identity),actorGY:actor.graveyard.map(identity),otherField:other.field.map(identity),otherGY:other.graveyard.map(identity)};
 // Production Bot clone from the real post-control state; only clone host capabilities are projected.
 const cloneActor=unsafeFixture<Parameters<typeof cloneBotGameState>[0]>({...actor,resolveOpponent:()=>other},'Live actor fields plus opponent resolver; cloneBotGameState does not use strategy methods.');
 const state=cloneBotGameState(cloneActor,unsafeFixture<BotCloneGamePort>(game,'Real Game supplies clone inputs.'));
 const cloned=required(state.player.field.concat(state.bot.field).find(c=>c.instanceId===synchro.instanceId));
 assert.equal(cloned.originalOwner,actor.id);assert.equal(cloned.owner,stolen?other.id:actor.id);
 assert.deepEqual(cloned.synchroMaterials,synchro.synchroMaterials);
 const beforeLive=JSON.stringify(createCanonicalStateSnapshot(game));
 const simAction={type:'spell' as const,index:actor.hand.indexOf(spell),cardId:19,activationContext:{decisions:{selections:{de_synchro_target:[required(synchro.instanceId)]}}}};
 applyGenericSimulatedMainPhaseAction(state,simAction,{selfId:'bot'});
 assert.equal(JSON.stringify(createCanonicalStateSnapshot(game)),beforeLive,'simulation never mutates live state');
 const sim={originalOwnerExtra:state.bot.extraDeck.some(c=>c.instanceId===synchro.instanceId),holderExtra:state.player.extraDeck.some(c=>c.instanceId===synchro.instanceId),sourceOwner:cloned.owner,sourceOriginalOwner:cloned.originalOwner,materialsOnActor:state.bot.field.filter(c=>[tuner.instanceId,material.instanceId].some(id=>id===c.instanceId)).map(c=>c.instanceId),decoyInGY:state.bot.graveyard.some(c=>c.instanceId===decoy.instanceId),unsupported:state._simUnsupportedActions||[]};
 const moveStart=moves.length,summonStart=summons.length,promptStart=prompts.length,positionStart=positions.length;
 const activation=game.tryActivateSpell(spell,actor.hand.indexOf(spell),null,{owner:actor});await drive(game,activation,choose);assert.equal((await activation).success,true);
 assert.deepEqual(sim.unsupported, []);
 assert.equal(sim.originalOwnerExtra, true); assert.equal(sim.holderExtra, false);
 assert.equal(sim.sourceOwner, actor.id); assert.equal(sim.sourceOriginalOwner, actor.id);
 assert.ok(actor.extraDeck.includes(synchro));assert.equal(other.extraDeck.includes(synchro),false);assert.equal(other.field.includes(synchro),false);assert.equal(actor.field.includes(synchro),false);
 assert.equal(synchro.originalOwner,actor.id);assert.equal(synchro.owner,actor.id);assert.equal(synchro.properSummonEstablished,false);
 assert.ok(actor.graveyard.includes(spell));assert.ok(actor.graveyard.includes(decoy));
 const revived=mode==='accept'||mode==='no-transfer';
 if (mode !== 'decline') assert.deepEqual(new Set(sim.materialsOnActor), new Set(revived ? [tuner.instanceId, material.instanceId] : [tuner.instanceId]));
 assert.equal(sim.decoyInGY, true);
 assert.equal(actor.field.includes(material),revived);assert.equal(actor.field.includes(tuner),revived||mode==='missing-exact');
 const revivePrompts=prompts.slice(promptStart).filter(p=>p.message.startsWith('Special Summon the Synchro Materials'));
 assert.equal(revivePrompts.length,mode==='missing-exact'?0:1);
 const deSummons=summons.slice(summonStart).filter(s=>Reflect.get(Object(s),'procedure')==='de_synchro_effect');
 assert.equal(deSummons.length,revived?2:0);
 if(revived){assert.equal(tuner.lastSummonProcedure,'de_synchro_effect');assert.equal(material.lastSummonProcedure,'de_synchro_effect');}
 assert.equal(other.field.includes(behemoth),stolen,'real field exit revives the bound Behemoth exactly when control was accepted');
 assert.equal(game.getTemporaryControlState().length,0);assert.equal(game.targetSelection,null);assert.equal(game.chainSystem.chainStack.length,0);assert.equal(game.chainSystem.pendingTriggerOccurrences.length,0);assert.equal(game.effectUsageReservations.size,0);
 playback.ui.showConfirmPrompt=async()=>assert.fail('replay confirmation');playback.ui.showChainResponseModal=async()=>assert.fail('replay response');playback.ui.showTriggerOrderModal=async()=>assert.fail('replay trigger order');playback.ui.showSpecialSummonPositionModal=()=>assert.fail('replay position');playback.ui.showTargetSelection=()=>assert.fail('replay target');playback.autoSelector.select=()=>assert.fail('replay AI');
 const replay=validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({reason:'de-synchro-owner'}))));
 const result=await replayCanonicalDuel(replay,{game:unsafeFixture<ReplayDriverGamePort>(playback,'Same initial main-deck fixture; both Synchros, combat control, phases and spells use real recorded paths.')});
 const normalized=(g:RuntimeGame,c:GameCard)=>c.synchroMaterials?.map(m=>{const all=[g.player,g.bot].flatMap(p=>[...p.field,...p.hand,...p.deck,...p.graveyard,...p.extraDeck,...p.banished]);return {...m,instanceId:g.ensureDuelCardId(required(all.find(x=>x.instanceId===m.instanceId)))};});
 assert.deepEqual(normalized(playback,required(playback[seat].extraDeck.find(c=>c.id===31))),normalized(game,synchro),'recorded physical materials also match outside canonical hash');
 assert.equal(result.ok,true);assert.equal(result.finalStateHash,replay.result?.finalStateHash);assert.deepEqual(createCanonicalStateSnapshot(playback),createCanonicalStateSnapshot(game));assert.deepEqual(playback.getRandomState(),game.getRandomState());assert.equal(playback.decisionBroker.replayCursor,replay.decisions.length);
});
