import type { GameState, Zone, ZoneKind, Catalog } from '../shared/types.js';
export const zoneId=(kind:ZoneKind,owner='scenario')=>owner+':'+kind;
export function zone(state:GameState,kind:ZoneKind,owner='scenario'):Zone {
  const id=zoneId(kind,owner);
  return state.zones[id]??(state.zones[id]={id,kind,owner,visibility:['deck','encounterDeck','setAside'].includes(kind)?'hidden':['hand','openingSetAside','search'].includes(kind)?'owner':'public',cards:[]});
}
export const cardsIn=(s:GameState,k:ZoneKind,owner='scenario')=>s.zones[zoneId(k,owner)]?.cards??[];
export const locationOf=(s:GameState,id:string):string|undefined=>{
  const inv=s.investigators.find(i=>i.id===id||i.cardId===id);if(inv)return inv.locationId;
  const c=s.cards[id];if(!c)return undefined;
  if(c.attachedTo)return locationOf(s,c.attachedTo);
  if(c.bearer)return locationOf(s,c.bearer);
  return s.scenario.locations.some(l=>l.cardId===id)?id:c.tokens.locationIndex!==undefined?s.scenario.locations[c.tokens.locationIndex]?.cardId:undefined;
};
export function moveCard(s:GameState,id:string,kind:ZoneKind,owner='scenario',catalog?:Catalog):void {
  const c=s.cards[id];if(!c)throw new Error('Missing card instance.');
  if(['deck','hand','openingSetAside','discard'].includes(kind)&&owner!==c.owner)throw new Error('Cards must return to their owner’s personal zones.');
  if(['assets','threat'].includes(kind)&&!s.investigators.some(i=>i.id===owner))throw new Error('Investigator area requires a valid investigator.');
  const source=Object.values(s.zones).find(z=>z.cards.includes(id));if(!source)throw new Error('Card has no zone.');
  const target=zone(s,kind,owner);
  if(source.id===target.id)return;
  source.cards.splice(source.cards.indexOf(id),1);
  const inPlay=['assets','threat','locations','enemies','attachments'];
  const leavesPlay=inPlay.includes(source.kind)&&!inPlay.includes(kind);
  if(leavesPlay||['discard','encounterDiscard','removed','victory'].includes(kind)) {
    for(const attached of Object.values(s.cards).filter(a=>a.attachedTo===id))discardCard(s,attached.id,catalog);
    delete c.attachedTo;delete c.bearer;c.exhausted=false;c.tokens={};c.controller=c.owner;
    s.engine.modifiers=s.engine.modifiers.filter(m=>m.source!==id);
  }
  if(source.kind==='attachments'&&kind!=='attachments')delete c.attachedTo;
  if(source.kind==='threat'&&kind!=='threat')delete c.bearer;
  if(kind==='assets')c.controller=owner;
  if(kind==='threat'){c.bearer=owner;c.controller=catalog?.cards[c.code].type==='asset'?owner:'scenario';}
  target.cards.push(id);
}
export function discardCard(s:GameState,id:string,catalog?:Catalog):void {
  const c=s.cards[id];const eliminated=s.investigators.some(i=>i.id===c.owner&&i.eliminated);moveCard(s,id,eliminated?'removed':c.owner==='scenario'?'encounterDiscard':'discard',eliminated?'scenario':c.owner,catalog);
}
export function attachCard(s:GameState,id:string,target:string,catalog:Catalog):void {
  if(id===target||!s.cards[target])throw new Error('Invalid attachment target.');
  for(let p:string|undefined=target;p;p=s.cards[p]?.attachedTo)if(p===id)throw new Error('Attachment cycle.');
  moveCard(s,id,'attachments','scenario',catalog);s.cards[id].attachedTo=target;
}
