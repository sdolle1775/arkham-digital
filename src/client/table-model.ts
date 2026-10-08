import type { Catalog, SessionView } from '../shared/types';

export type ViewFilter = 'all'|'relevant'|'focused';
export type CardSort = 'table'|'name'|'type';
export interface ViewPreferences { allHands:boolean; filter:ViewFilter; pinned:boolean; previews:boolean; text:boolean; sort:CardSort; }
export const defaultPreferences:ViewPreferences={allHands:true,filter:'all',pinned:true,previews:true,text:false,sort:'table'};
export interface Camera { x:number; y:number; zoom:number; }
export const clampZoom=(zoom:number)=>Math.max(.2,Math.min(1.8,zoom));
export function cardActions(session:SessionView,investigatorId:string,cardId:string|null) {
  const identity=session.investigators.find(i=>i.id===investigatorId)?.cardId;
  return session.allowedActions.filter(a=>a.investigatorId===investigatorId&&!a.id.startsWith('end-turn|')&&(!cardId||a.source===cardId||a.target===cardId||a.id.split('|').slice(1).includes(cardId)||cardId===identity&&!a.source&&!a.target));
}
export function relevantCards(session:SessionView):Set<string> {
  return new Set([...session.allowedActions.flatMap(a=>[a.source,a.target,...a.id.split('|').slice(1)].filter((v):v is string=>!!v)),...session.pendingChoices.flatMap(c=>(c.options??[]).flatMap(o=>o.cardId?[o.cardId]:[]))]);
}
export function displayCards(ids:string[],session:SessionView,catalog:Catalog,sort:CardSort):string[] {
  if(sort==='table')return [...ids];
  return [...ids].sort((a,b)=>{const x=catalog.cards[session.cards[a]?.code],y=catalog.cards[session.cards[b]?.code];return (sort==='type'?(x?.type??'').localeCompare(y?.type??''):0)||(x?.name??'').localeCompare(y?.name??'');});
}
export function tableLayout(session:SessionView) {
  const locations=session.scenario.locations;
  const minX=Math.min(...locations.map(l=>l.x)),minY=Math.min(...locations.map(l=>l.y));
  const spanX=Math.max(...locations.map(l=>l.x))-minX,spanY=Math.max(...locations.map(l=>l.y))-minY;
  const width=Math.max(1840,session.investigators.length*700+160,spanX*1.5+800);
  const positions=Object.fromEntries(locations.map(l=>[l.cardId,{x:(width-spanX*1.5)/2+(l.x-minX)*1.5-75,y:370+(l.y-minY)*1.5}]));
  const mapBottom=370+spanY*1.5+300;
  const publicRows=Math.max(0,...session.investigators.map(i=>Math.ceil((i.assets.length+i.threat.length+Object.values(session.cards).filter(c=>c.attachedTo&&[...i.assets,...i.threat].includes(c.attachedTo)).length)/4)));
  const investigatorsY=mapBottom+60+publicRows*260;
  const handRows=Math.max(1,...session.investigators.map(i=>Math.ceil(i.handCount/10)));
  return {width,height:investigatorsY+390+handRows*235,positions,investigatorsY,publicRows,
    seats:Object.fromEntries(session.investigators.map((i,index)=>[i.id,{x:(width-session.investigators.length*700)/2+index*700+25,y:investigatorsY}]))};
}
export function fitCamera(width:number,height:number,viewport:{width:number;height:number}):Camera {
  const zoom=clampZoom(Math.min((viewport.width-170)/width,(viewport.height-110)/height));
  return {x:(viewport.width-width*zoom)/2,y:65+(viewport.height-100-height*zoom)/2,zoom};
}
