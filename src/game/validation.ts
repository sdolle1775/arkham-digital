import { z } from 'zod';
import type { Catalog, GameState } from '../shared/types.js';
import { EFFECT_TYPES } from './engine.js';
import { campaignLogFlags } from './campaigns/brethren.js';
import { cardsIn } from './zones.js';
const id=z.string().min(1).max(128).regex(/^[a-zA-Z0-9_:|-]+$/);
const n=z.number().int().min(0).max(1000000),ids=z.array(id).max(2000),text=z.string().max(100000);
const effect=z.object({id,step:n,type:z.enum(EFFECT_TYPES),actor:id.optional(),source:id.optional(),target:id.optional(),amount:z.number().int().min(-1000).max(1000).optional(),data:z.record(z.string(),z.unknown()).optional(),paidCosts:z.object({resources:n,actions:n}).optional()}).strict();
const test=z.object({id,actor:id,source:z.string().max(128).optional(),target:z.string().max(128).optional(),skill:z.enum(['willpower','intellect','combat','agility']),difficulty:n,bonus:z.number().int(),damage:n,action:id,stage:n,committed:ids,tokens:z.array(z.string().max(30)),tokenModifier:z.number().int(),success:z.boolean().optional(),margin:z.number().int().optional(),elderSign:z.boolean().optional(),peril:z.boolean().optional(),participants:ids}).strict();
const schema=z.object({schemaVersion:z.literal(2),sessionId:id,name:text,buildVersion:text,catalogVersion:text,rules:z.object({id,tabooId:n,tabooDate:text,tabooUpdated:text,tabooHash:text,catalogVersion:text,scriptVersion:text}).strict(),revision:n,createdAt:z.iso.datetime(),phase:z.enum(['opening','ready','playing','ended','unsupported']),mode:z.enum(['hotseat','separate']),difficulty:z.enum(['easy','standard','hard','expert']),leadInvestigatorId:id,
 investigators:z.array(z.object({id,seat:z.number().int().min(1).max(4),name:text,investigatorCode:id,deckRevisionId:id,cardId:id,eliminated:z.boolean(),turnEnded:z.boolean(),resources:n,health:n,sanity:n,damage:n,horror:n,actions:n,clues:n,locationId:id,weaknessCodes:ids,mulliganComplete:z.boolean()}).strict()).min(1).max(4),
 cards:z.record(id,z.object({id,code:id,face:z.enum(['front','back']),exhausted:z.boolean(),tokens:z.record(id,n),owner:id,controller:id,bearer:id.optional(),attachedTo:id.optional()}).strict()),
 zones:z.record(id,z.object({id,kind:z.enum(['deck','hand','openingSetAside','assets','threat','discard','identity','reference','acts','agendas','encounterDeck','encounterDiscard','setAside','victory','removed','locations','enemies','attachments','resolving','committed','search']),owner:id,visibility:z.enum(['public','owner','hidden']),cards:ids}).strict()),
 scenario:z.object({id:z.literal('spreading_flames'),name:z.literal('Spreading Flames'),locations:z.array(z.object({cardId:id,x:z.number().finite(),y:z.number().finite(),connections:ids}).strict()).min(1).max(100),chaosBag:z.array(z.string().max(30)).min(1).max(100)}).strict(),
 campaign:z.object({id:z.literal('brethren_of_ash'),name:z.literal('Brethren of Ash'),scenarioNumber:z.literal(1),log:z.object({entries:text,records:z.record(id,z.object({experience:n,physicalTrauma:n,mentalTrauma:n,notes:text}).strict()),flags:ids}).strict()}).strict(),
 rng:z.object({algorithm:z.literal('xoshiro128ss-v1'),state:z.tuple([z.number().int().min(0).max(0xffffffff),z.number().int().min(0).max(0xffffffff),z.number().int().min(0).max(0xffffffff),z.number().int().min(0).max(0xffffffff)])}).strict(),
 setup:z.object({order:ids,completed:ids}).strict(),pendingChoices:z.array(z.object({id,type:z.enum(['mulligan','decision']),investigatorId:id,prompt:text.optional(),options:z.array(z.object({id:z.string().max(300),label:text,cardId:id.optional()}).strict()).optional(),min:n.optional(),max:n.optional(),private:z.boolean().optional(),context:z.record(z.string(),text).optional()}).strict()).max(4),
 resolutionStack:z.array(effect).max(1000),queuedTests:z.array(test).max(100),test:test.nullable(),engine:z.object({pilot:z.boolean(),round:n,phase:z.enum(['investigation','enemy','upkeep','mythos']),activeInvestigatorId:id.nullable(),nextId:n,actionDepth:n,log:z.array(text).max(300),blockedReason:text.optional(),limits:z.record(z.string(),n),attacked:z.record(z.string(),n),modifiers:z.array(z.object({id,source:id,target:id,stat:text,amount:z.number().int(),expires:z.enum(['test','phase','round','game'])}).strict()),experiencePenalty:z.record(id,n),outcomes:z.array(z.object({kind:text,value:text}).strict()).max(100000)}).strict()
}).strict();
function requireState(ok:unknown,message:string):asserts ok{if(!ok)throw new Error('Invalid save: '+message);}
export function validateGameState(input:unknown,catalog:Catalog):asserts input is GameState {
 let nodes=0;
 const safeJson=(value:any,depth=0):void=>{if(++nodes>200000||depth>60)throw new Error('Invalid save: excessive nested data.');if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid save: unsafe object key.');safeJson(child,depth+1);}};
 safeJson(input);
 const parsed=schema.safeParse(input);if(!parsed.success)throw new Error('Invalid save structure: '+parsed.error.issues[0]?.path.join('.')+' '+parsed.error.issues[0]?.message);
 const s=parsed.data as GameState;requireState(s.catalogVersion===catalog.version&&s.rules.catalogVersion===catalog.version,'incompatible content version');requireState(s.rng.state.some(Boolean),'zero RNG state');
 const investigators=new Set(s.investigators.map(i=>i.id));requireState(investigators.size===s.investigators.length&&investigators.has(s.leadInvestigatorId),'invalid investigator identities');
 requireState(new Set(s.investigators.map(i=>i.investigatorCode)).size===s.investigators.length,'duplicate investigator');
 requireState(s.setup.order.length===investigators.size&&new Set(s.setup.order).size===investigators.size&&s.setup.order.every(id=>investigators.has(id)),'invalid player order');
 requireState(s.engine.activeInvestigatorId===null||investigators.has(s.engine.activeInvestigatorId),'unknown active investigator');
 requireState(new Set(s.setup.completed).size===s.setup.completed.length&&s.setup.completed.every(id=>investigators.has(id)),'invalid completed setup');
 requireState(JSON.stringify(campaignLogFlags(s.campaign.log.entries))===JSON.stringify(s.campaign.log.flags),'campaign log flags differ');
 requireState(Object.keys(s.campaign.log.records).length===investigators.size&&Object.keys(s.campaign.log.records).every(id=>investigators.has(id)),'campaign records differ');
 const owned=new Set<string>();
 for(const [key,z]of Object.entries(s.zones)){
  requireState(key===z.id&&key===z.owner+':'+z.kind,'invalid zone identity');requireState(z.owner==='scenario'||investigators.has(z.owner),'invalid zone owner');
  const expected=['deck','encounterDeck','setAside'].includes(z.kind)?'hidden':['hand','openingSetAside','search'].includes(z.kind)?'owner':'public';requireState(z.visibility===expected,'invalid zone visibility');
  for(const id of z.cards){requireState(s.cards[id]&&!owned.has(id),'missing or duplicate zone membership');owned.add(id);if(['deck','hand','openingSetAside','discard','search'].includes(z.kind))requireState(s.cards[id].owner===z.owner&&investigators.has(z.owner),'private zone ownership mismatch');if(z.kind==='attachments')requireState(s.cards[id].attachedTo,'unattached card in attachment zone');}
 }
 requireState(owned.size===Object.keys(s.cards).length&&owned.size<=2000,'unassigned or excessive card instances');
 for(const [key,c]of Object.entries(s.cards)){
  requireState(key===c.id&&catalog.cards[c.code]?.faces.some(f=>f.id===c.face),'unknown card or face');
  requireState([c.owner,c.controller].every(id=>id==='scenario'||investigators.has(id)),'invalid ownership/control');
  if(c.bearer)requireState(investigators.has(c.bearer),'invalid bearer');
  if(c.attachedTo){const visited=new Set([key]);for(let p:string|undefined=c.attachedTo;p;p=s.cards[p]?.attachedTo){requireState(s.cards[p]&&!visited.has(p),'invalid attachment');visited.add(p);}}
 }
 for(const l of s.scenario.locations)requireState(cardsIn(s,'locations').includes(l.cardId)&&l.connections.every(id=>s.scenario.locations.some(x=>x.cardId===id)),'invalid location graph');
 for(const i of s.investigators){requireState(catalog.cards[i.investigatorCode]?.type==='investigator'&&s.cards[i.cardId]?.code===i.investigatorCode,'investigator identity mismatch');requireState(s.scenario.locations.some(l=>l.cardId===i.locationId),'missing investigator location');}
 for(const p of s.pendingChoices){requireState(investigators.has(p.investigatorId),'choice has invalid controller');if(p.options)requireState(new Set(p.options.map(o=>o.id)).size===p.options.length,'duplicate choice option');}
 const validateEffect=(e:any,depth=0):void=>{
  requireState(depth<50&&e&&EFFECT_TYPES.includes(e.type),'unknown serialized effect');
  if(e.actor)requireState(investigators.has(e.actor),'unknown effect actor');if(e.source)requireState(s.cards[e.source],'unknown effect source');
  if(e.target)requireState(s.cards[e.target]||investigators.has(e.target),'unknown effect target');
  if(e.amount!==undefined)requireState(Number.isInteger(e.amount)&&Math.abs(e.amount)<=1000,'invalid effect amount');
  if(['gain','heal','lose-resources','draw','damage','apply-assignment','check-defeat','eliminate','test','search','shuffle','hand-limit','enemy-attacks','cosmic','smoke','heal-choice','joe','encounter-draw'].includes(e.type))requireState(investigators.has(e.actor),'effect needs an investigator');
  if(['attack','attack-after','defeat-enemy','play','asset-enter','reveal-intuition','threat','discard','spawn','harm','fire-attach','encounter','encounter-cleanup','mark-surge','agenda-advance','agenda-finish','act-finish','hunter','exhaust'].includes(e.type))requireState(s.cards[e.source],'effect needs a source card');
  if(['move','engage','auto-engage','evaded'].includes(e.type)||e.type==='enemy-damage'&&!e.data?.fire)requireState(s.cards[e.target],'effect needs a target card');
  if(['test','invoke','window','order','eliminate','mark-limit','unsupported'].includes(e.type))requireState(e.data&&typeof e.data==='object','effect needs continuation data');
  if(e.type==='test')requireState(['willpower','intellect','combat','agility'].includes(e.data.skill)&&Number.isInteger(e.data.difficulty)&&e.data.difficulty>=0&&typeof e.data.action==='string','invalid test effect');
  if(e.type==='window')requireState(Array.isArray(e.data.actors)&&e.data.actors.every((id:string)=>investigators.has(id))&&Array.isArray(e.data.continuation),'invalid player window');
  if(e.type==='invoke')requireState(typeof e.data.actionId==='string'&&e.data.actionId.split('|').length===3,'invalid action continuation');
  for(const key of ['effects','continuation'])if(e.data?.[key]){requireState(Array.isArray(e.data[key])&&e.data[key].length<=1000,'invalid continuation');e.data[key].forEach((child:any)=>validateEffect(child,depth+1));}
 };
 for(const frame of s.resolutionStack)validateEffect(frame);
 for(const p of s.pendingChoices)if(p.type==='decision'){
  requireState(p.context&&['effects','turn','lead','commit','heal','search','attach','hunter','discard-hand'].includes(p.context.kind),'unknown choice continuation');
  requireState((p.min??1)<=(p.max??1),'invalid choice bounds');
  requireState((p.min??1)<=(p.options?.length??0),'choice has too few options');
  if(['turn','lead'].includes(p.context.kind))requireState(p.options?.every(o=>investigators.has(o.id)),'unknown investigator choice');
  if(['search','commit','discard-hand'].includes(p.context.kind))requireState(p.options?.every(o=>cardsIn(s,p.context!.kind==='search'?'search':'hand',p.investigatorId).includes(o.id)),'choice does not match its private area');
  if(p.context.kind==='commit')requireState(s.test,'commit choice has no skill test');
  if(p.context.kind==='effects')for(const option of p.options??[]){let effects;try{effects=JSON.parse(p.context[option.id]);}catch{throw new Error('Invalid save: invalid choice effects.');}requireState(Array.isArray(effects)&&effects.length<=1000,'invalid choice effects');safeJson(effects);effects.forEach(e=>validateEffect(e));}
 }
 for(const frame of s.resolutionStack){if(frame.actor)requireState(investigators.has(frame.actor),'unknown effect actor');if(frame.source)requireState(s.cards[frame.source],'unknown effect source');}
 for(const t of [s.test,...s.queuedTests].filter(Boolean)){requireState(investigators.has(t!.actor)&&t!.stage<=8&&t!.committed.every(id=>cardsIn(s,'committed').includes(id)),'invalid skill test');}
 if(!s.engine.pilot)requireState(['opening','ready'].includes(s.phase)&&!s.test&&!s.resolutionStack.length&&!s.queuedTests.length,'normal campaigns support setup only');
 if(s.phase==='opening'){
  const pending=s.setup.order.filter(id=>!s.setup.completed.includes(id));requireState(JSON.stringify(s.pendingChoices.map(c=>c.investigatorId))===JSON.stringify(pending),'mulligan order differs');
  for(const i of s.investigators)requireState(cardsIn(s,'hand',i.id).length===5&&cardsIn(s,'hand',i.id).every(id=>!['weakness','basicweakness'].includes(catalog.cards[s.cards[id].code].subtype??'')),'invalid opening hand');
 }
}
