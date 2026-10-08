import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadCatalog} from '../../src/server/catalog.js';
import {compileRules} from '../../src/server/rules.js';
import {createGame,applyCommand,validateGameState} from '../../src/game/setup.js';
import {advance} from '../../src/game/engine.js';
import {push} from '../../src/game/chapter/context.js';
import {cardsIn,moveCard,zone} from '../../src/game/zones.js';
import type {DeckRevision,Effect,GameCommand,GameState,ZoneKind} from '../../src/shared/types.js';

export const pin=JSON.parse(readFileSync('content/audit/pin.json','utf8'));
export const rules=compileRules(loadCatalog('content'),pin.taboo,pin.taboo,'chapter2-3'),c=rules.catalog;
export const registry=JSON.parse(readFileSync('content/audit/requirements.json','utf8')).requirements as Requirement[];
export interface Requirement {id:string;code:string;face?:string;kind:string;text?:string;field?:string;expected?:unknown;status:string;reason?:string;source:string;cases?:string[];}
export interface AuditCase {id:string;title:string;covers:string[];complete?:boolean;references:string[];run:()=>void|Promise<void>;}
export let fixtureDecks:DeckRevision[]=[];
export let reproduction:{seed:number;state:GameState;operation:unknown}|undefined;
let fixtureSeed=0;
export function recordFixture(decks:DeckRevision[],seed:number):void {fixtureDecks=decks;fixtureSeed=seed;reproduction=undefined;}
export function recordOperation(state:GameState,operation:unknown):void {reproduction={seed:fixtureSeed,state:structuredClone(state),operation};}
export const clauses=(code:string,pattern:RegExp)=>registry.filter(r=>r.code===code&&r.text&&pattern.test(r.text)).map(r=>r.id);
export const fields=(code:string,...keys:string[])=>keys.map(k=>`${code}/field/${k}`).filter(id=>registry.some(r=>r.id===id));
export const actor='investigator-1';
export const serialized=<T>(s:T):T=>JSON.parse(JSON.stringify(s));
export function fixture(count=1,code='12001',seed=1701):GameState {
 const decks:DeckRevision[]=Array.from({length:count},(_,n)=>({id:`audit-deck-${n}`,libraryId:`audit-library-${n}`,revision:1,source:'published',sourceCode:'audit-'+n,name:'Audit fixture',investigatorCode:n?['12004','12007','12010'].filter(cd=>cd!==code)[n-1]??'12013':code,slots:{'12089':2,'12090':2,'12091':2,'12092':2,'12093':2,'12094':2,'12021':2,'12086':2,'12087':2,'12088':2,'12017':2,'12035':2,'12047':2,'12063':2,'12076':2,'12101':1},sideSlots:{},unsupported:[],importedAt:'2026-10-07T00:00:00Z',rules:rules.identity,purchaseXp:0}));
 recordFixture(decks,seed);
 let s=createGame({sessionId:'audit-session',name:'Rules audit',mode:'hotseat',difficulty:'standard',leadSeat:1,seats:decks.map((d,n)=>({deckRevisionId:d.id,playerName:'P'+(n+1)})),seed,createdAt:'2026-10-07T00:00:00Z'},c,decks,rules.identity);
 for(const id of s.setup.order)s=applyCommand(s,{type:'mulligan',investigatorId:id,cardIds:[]},c);
 if(count>1){assert.equal(s.pendingChoices[0].prompt,'Choose the next investigator');s=respond(s,[actor]);}
 for(const i of s.investigators)for(const id of [...cardsIn(s,'hand',i.id)])moveCard(s,id,'deck',i.id,c);
 // Test setup removes private randomness from later draws, without inflating stats.
 for(const i of s.investigators)zone(s,'deck',i.id).cards.sort((a,b)=>Number(!!c.cards[s.cards[a].code].subtype)-Number(!!c.cards[s.cards[b].code].subtype));
 s.scenario.chaosBag=['0'];validateGameState(s,c);return s;
}
export function add(s:GameState,code:string,kind:ZoneKind='hand',owner=actor):string {
 const id='audit-card-'+Object.keys(s.cards).length;s.cards[id]={id,code,face:'front',owner,controller:owner,exhausted:false,tokens:{}};zone(s,kind,owner).cards.push(id);
 if(kind==='threat')s.cards[id].bearer=owner;
 if(kind==='enemies')s.cards[id].tokens.locationIndex=0;
 return id;
}
export function command(s:GameState,cmd:GameCommand):GameState{recordOperation(s,{command:cmd});return applyCommand(s,cmd,c,ss=>validateGameState(ss,c));}
export function respond(s:GameState,optionIds:string[]):GameState {const p=s.pendingChoices[0];assert.ok(p,'Missing expected choice');return command(s,{type:'choose',investigatorId:p.investigatorId,choiceId:p.id,optionIds});}
export function expectChoice(s:GameState,prompt:string|RegExp,options:string[],who=actor,min=1,max=1):void {
 const p=s.pendingChoices[0];assert.ok(p,'Missing choice '+prompt);assert.equal(s.pendingChoices.length,1);
 if(typeof prompt==='string')assert.equal(p.prompt,prompt);else assert.match(p.prompt!,prompt);
 assert.equal(p.investigatorId,who);assert.deepEqual(p.options!.map(o=>o.id).sort(),[...options].sort());assert.equal(p.min,min);assert.equal(p.max,max);
}
export function effects(s:GameState,...effects:Effect[]):GameState {recordOperation(s,{effects});s=structuredClone(s);push({s,c},effects);advance(s,c,ss=>validateGameState(ss,c));validateGameState(s,c);return s;}
export function locations(s:GameState):string[]{
 const first=s.scenario.locations[0].cardId,ids=[first,add(s,'12116','locations','scenario'),add(s,'12117','locations','scenario')];
 s.scenario.locations=ids.map((cardId,n)=>({cardId,x:n*300,y:0,connections:ids.filter(id=>id!==cardId)}));
 return ids;
}
export function review(s:GameState):GameState {expectChoice(s,'Review the chaos result, then continue.',[],s.test!.actor,0,0);return respond(s,[]);}
