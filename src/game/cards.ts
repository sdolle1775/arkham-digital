import type { AbilityDefinition, Catalog, Effect } from '../shared/types.js';

export const PILOT_CODES=['12001','12002','12003','12004','12005','12006','12019','12023','12025','12032','12089','12093','12101','12105','12106','12109','12113','12116','12117','12114','12121','12123','12124','12129','12130','12132'] as const;
export const scripted=(code:string)=>PILOT_CODES.includes(code as typeof PILOT_CODES[number]);
/** Pure card modules describe effects; only the engine can interpret or mutate them. */
export const cardEffects:Record<string,(actor:string,source:string)=>Effect[]>={
  '12005':(actor,source)=>[{type:'gain',actor,source,amount:2},{type:'heal-choice',actor,source}],
  '12006':()=>[],
  '12023':(actor,source)=>[{type:'search',actor,source,amount:9}],
  '12089':(actor,source)=>[{type:'gain',actor,source,amount:3}],
  '12101':(actor,source)=>[{type:'lose-resources',actor,source}],
  '12003':(actor,source)=>[{type:'threat',actor,source}],
  '12124':(actor,source)=>[{type:'cosmic',actor,source}],
  '12129':(actor,source)=>[{type:'fire-attach',actor,source}],
  '12130':(actor,source)=>[{type:'smoke',actor,source}],
};
export const abilities:AbilityDefinition[]=[
  {id:'wrench-lure',cardCode:'12002',timing:'fast',label:'Exhaust Wrench: provoke an attack'},
  {id:'wrench-fight',cardCode:'12002',timing:'action',label:'Fight with Daniela’s Wrench'},
  {id:'pistol-fight',cardCode:'12019',timing:'action',label:'Fight with M1911 (1 ammo)'},
  {id:'room-engage',cardCode:'12113',timing:'action',label:'Draw a connecting enemy here and engage'},
  {id:'quad-move',cardCode:'12116',timing:'fast',label:'Move from Miskatonic Quad'},
  {id:'dorm-heal',cardCode:'12117',timing:'action',label:'Heal 1 damage and 1 horror'},
  {id:'fire-test',cardCode:'12129',timing:'action',label:'Extinguish Fire!'},
  {id:'agenda-parley',cardCode:'12106',timing:'action',label:'Parley with a Bystander'},
];
export function cardNumber(catalog:Catalog,code:string,key:string,fallback=0):number {
  const n=catalog.cards[code]?.raw[key];return typeof n==='number'?n:fallback;
}
