import type { Catalog, SessionView } from '../shared/types';

export type ViewFilter = 'all'|'relevant'|'focused';
export type CardSort = 'table'|'name'|'type';
export interface ViewPreferences { allHands:boolean; filter:ViewFilter; pinned:boolean; previews:boolean; text:boolean; sort:CardSort; }
export const defaultPreferences:ViewPreferences={allHands:true,filter:'all',pinned:true,previews:true,text:false,sort:'table'};
export interface Camera { x:number; y:number; zoom:number; }
export const clampZoom=(zoom:number)=>Math.max(.2,Math.min(1.8,zoom));
export function movementActions(session:SessionView,investigatorId:string) {
  return session.allowedActions.filter(a=>a.investigatorId===investigatorId&&a.id.startsWith('move|')&&a.target);
}
export function cardActions(session:SessionView,investigatorId:string,cardId:string|null) {
  if(!cardId)return [];
  const identity=session.investigators.find(i=>i.id===investigatorId)?.cardId;
  return session.allowedActions.filter(a=>a.investigatorId===investigatorId&&!a.id.startsWith('end-turn|')&&!a.id.startsWith('move|')&&(a.source===cardId||a.target===cardId||a.id.split('|').slice(1).includes(cardId)||cardId===identity&&!a.source&&(!a.target||a.id.startsWith('investigate|'))));
}
/** Read only projected public piles; hands and search pools never enter the map. */
export function cardsAtLocation(session:SessionView,locationId:string):string[] {
  const publicIds=new Set(session.piles.filter(p=>p.visibility==='visible'&&['enemies','attachments'].includes(p.kind)).flatMap(p=>p.cards));
  const result=new Set<string>();
  const at=(id:string,seen=new Set<string>()):boolean=>{
    if(seen.has(id))return false;seen.add(id);const card=session.cards[id];if(!card)return false;
    if(card.attachedTo)return card.attachedTo===locationId||publicIds.has(card.attachedTo)&&at(card.attachedTo,seen);
    if(card.bearer&&session.investigators.some(i=>i.id===card.bearer))return false;
    return card.bearer===locationId||card.tokens.locationIndex!==undefined&&session.scenario.locations[card.tokens.locationIndex]?.cardId===locationId;
  };
  for(const id of publicIds)if(at(id))result.add(id);
  return [...result];
}
export function relevantCards(session:SessionView):Set<string> {
  return new Set([...session.allowedActions.flatMap(a=>[a.source,a.target,...a.id.split('|').slice(1)].filter((v):v is string=>!!v)),...session.pendingChoices.flatMap(c=>(c.options??[]).flatMap(o=>o.cardId?[o.cardId]:[]))]);
}
export function displayCards(ids:string[],session:SessionView,catalog:Catalog,sort:CardSort):string[] {
  if(sort==='table')return [...ids];
  return [...ids].sort((a,b)=>{const x=catalog.cards[session.cards[a]?.code],y=catalog.cards[session.cards[b]?.code];return (sort==='type'?(x?.type??'').localeCompare(y?.type??''):0)||(x?.name??'').localeCompare(y?.name??'');});
}
export function tableLayout(session:SessionView) {
  const locations=session.scenario.locations,columns=[...new Set(locations.map(l=>l.x))].sort((a,b)=>a-b),rows=[...new Set(locations.map(l=>l.y))].sort((a,b)=>a-b);
  const clusters=locations.map(l=>{const cards=cardsAtLocation(session,l.cardId),tiles=1+cards.length+(l.facedownCount?1:0),cols=Math.min(3,tiles);return {l,cards,cols,width:cols*190+32,height:Math.ceil(tiles/cols)*310+32};});
  const columnWidths=columns.map(x=>Math.max(...clusters.filter(p=>p.l.x===x).map(p=>p.width))),rowHeights=rows.map(y=>Math.max(...clusters.filter(p=>p.l.y===y).map(p=>p.height)));
  const mapWidth=columnWidths.reduce((a,b)=>a+b,0)+Math.max(0,columns.length-1)*80;
  const mapHeight=rowHeights.reduce((a,b)=>a+b,0)+Math.max(0,rows.length-1)*75;
  const width=Math.max(1840,session.investigators.length*700+160,mapWidth+160),mapTop=370+(session.piles.some(p=>['committed','resolving'].includes(p.kind)&&p.cards.length)?300:0);
  const positions:Record<string,{x:number;y:number}>={},locationZones:Record<string,{x:number;y:number;width:number;height:number;cards:{id:string;x:number;y:number}[];hidden?:{x:number;y:number}}>= {};
  for(const p of clusters){const col=columns.indexOf(p.l.x),row=rows.indexOf(p.l.y),x=(width-mapWidth)/2+columnWidths.slice(0,col).reduce((a,b)=>a+b,0)+col*80+(columnWidths[col]-p.width)/2,y=mapTop+rowHeights.slice(0,row).reduce((a,b)=>a+b,0)+row*75;
    const tile=(n:number)=>({x:36+n%p.cols*190,y:16+Math.floor(n/p.cols)*310});
    positions[p.l.cardId]={x:x+36,y:y+16};locationZones[p.l.cardId]={x,y,width:p.width,height:p.height,cards:p.cards.map((id,n)=>({id,...tile(n+1)})),...(p.l.facedownCount?{hidden:tile(p.cards.length+1)}:{})};
  }
  const publicRows=Math.max(0,...session.investigators.map(i=>Math.ceil((i.assets.length+i.threat.length+Object.values(session.cards).filter(c=>c.attachedTo&&[...i.assets,...i.threat].includes(c.attachedTo)).length)/4)));
  const investigatorsY=mapTop+mapHeight+90+publicRows*300;
  const handRows=Math.max(1,...session.investigators.map(i=>Math.ceil(i.handCount/10)));
  return {width,height:investigatorsY+390+handRows*235,positions,locationZones,investigatorsY,publicRows,
    seats:Object.fromEntries(session.investigators.map((i,index)=>[i.id,{x:(width-session.investigators.length*700)/2+index*700+25,y:investigatorsY}]))};
}
export function fitCamera(width:number,height:number,viewport:{width:number;height:number}):Camera {
  const zoom=clampZoom(Math.min((viewport.width-170)/width,(viewport.height-110)/height));
  return {x:(viewport.width-width*zoom)/2,y:65+(viewport.height-100-height*zoom)/2,zoom};
}
