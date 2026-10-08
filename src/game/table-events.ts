import type { CardInstance, GameState, SessionView, TableAnimation, TableMotion, Zone } from '../shared/types.js';

type Endpoint = Pick<Zone, 'id'|'kind'|'owner'|'visibility'>;
export type TableEvent = {kind:'move';card:CardInstance;from:Endpoint;to:Endpoint} | {kind:'shuffle';pile:Endpoint};
let recording:TableEvent[]|undefined;

/** Commands resolve synchronously. Keep cosmetic events outside snapshots and RNG. */
export function captureTableEvents<T>(resolve:()=>T):{value:T;events:TableEvent[]} {
  const previous=recording,events:TableEvent[]=[];recording=events;
  try{return {value:resolve(),events};}finally{recording=previous;}
}
const endpoint=({id,kind,owner,visibility}:Zone):Endpoint=>({id,kind,owner,visibility});
export function recordCardMove(card:CardInstance,from:Zone,to:Zone):void {
  if(recording)recording.push({kind:'move',card:structuredClone(card),from:endpoint(from),to:endpoint(to)});
}
export function recordShuffle(pile:Zone):void {recording?.push({kind:'shuffle',pile:endpoint(pile)});}

/** Use exactly the already-authorized projection. No deck identities or order travel to clients. */
export function projectTableEvents(events:TableEvent[],view:SessionView,fromCheckpointId:string):TableAnimation {
  const controlled=new Set(view.investigators.filter(i=>i.canControl).map(i=>i.id));
  const publicArea=(p:Endpoint)=>p.visibility==='public'&&!['acts','agendas','underAct'].includes(p.kind);
  const visible=(p:Endpoint)=>publicArea(p)||p.visibility==='owner'&&controlled.has(p.owner);
  const privateArea=(p:Endpoint)=>['search','openingSetAside'].includes(p.kind)&&!controlled.has(p.owner);
  const eventsOut:TableMotion[]=[];
  for(const event of events){
    if(event.kind==='shuffle'){
      if(['deck','encounterDeck'].includes(event.pile.kind))eventsOut.push({kind:'shuffle',pile:event.pile.id});
      continue;
    }
    const {card,from,to}=event;
    if(privateArea(from)||privateArea(to))continue;
    if(from.visibility==='hidden'&&to.visibility==='hidden')continue;
    const known=visible(from)||visible(to);
    eventsOut.push({kind:'move',from:from.id,to:to.id,back:card.owner==='scenario'?'encounter':'player',
      ...(known?{cardId:card.id,code:card.code,face:card.face}:{}),
      faceUpFrom:known&&visible(from),faceUpTo:known&&visible(to)});
  }
  return {fromCheckpointId,events:eventsOut};
}
