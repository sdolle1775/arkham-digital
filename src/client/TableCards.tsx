import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { Catalog, SessionView } from '../shared/types';
import { CardArt } from './components';
import { cardText } from './api';
import playerBack from './assets/player_back.png';
import encounterBack from './assets/encounter_back.png';

export interface Preview { id:string; code?:string; face:'front'|'back'; reverse:boolean; back?:'player'|'encounter'; x:number; }
export interface TableCardsContext {
  session:SessionView; catalog:Catalog; selected:Set<string>; legal:Set<string>; selecting:boolean;
  activeCard:string|null;
  inspect:(code:string,face?:'front'|'back')=>void; click:(id:string)=>void;
  preview:Preview|null; show:(value:Preview|null)=>void;
}
export const CardsContext=createContext<TableCardsContext>(null!);
export function CardBack({kind='player'}:{kind?:'player'|'encounter'}) {
  return <div className={`table-card-back ${kind}`} aria-hidden="true"><img src={kind==='player'?playerBack:encounterBack} alt="" draggable={false}/></div>;
}
export function TableCard({id,hidden=false,back='player',style,children,mapCard=false}:{mapCard?:boolean;id:string;hidden?:boolean;back?:'player'|'encounter';style?:CSSProperties;children?:ReactNode}) {
  const c=useContext(CardsContext),instance=hidden?undefined:c.session.cards[id],definition=instance?c.catalog.cards[instance.code]:undefined;
  const concealed=hidden||!instance;
  const legal=!concealed&&c.legal.has(id),selected=c.selected.has(id);
  const show=(element:HTMLElement,reverse=false)=>c.show({id,code:definition?.code,face:instance?.face??'back',reverse,back:concealed?back:definition?.encounterCode?'encounter':'player',x:element.getBoundingClientRect().left});
  const flip=(element:HTMLElement)=>show(element,c.preview?.id===id?!c.preview.reverse:true);
  const label=concealed?`${back==='player'?'Player':'Encounter'} card back`:definition?.faces.find(f=>f.id===instance?.face)?.name??definition?.name??'Card';
  return <div className={`table-card-wrap ${mapCard?'map-card map-'+(definition?.type==='enemy'?'enemy':definition?.type==='treachery'?'treachery':'player'):''} ${instance?.exhausted?'is-exhausted':''} ${instance?.face==='front'&&['investigator','act','agenda'].includes(definition?.type??'')?'landscape':''}`} style={style}>
    <button type="button" className={`table-card ${legal?'legal-target':''} ${selected?'is-selected':''} ${!concealed&&c.activeCard===id?'action-card':''} ${c.selecting&&!legal&&!concealed?'not-target':''}`} aria-label={label} aria-pressed={legal?selected:!concealed?c.activeCard===id:undefined} data-card-id={concealed?undefined:id}
      onMouseEnter={e=>show(e.currentTarget)} onMouseLeave={()=>c.show(null)} onFocus={e=>show(e.currentTarget)} onBlur={()=>c.show(null)}
      onContextMenu={e=>{e.preventDefault();e.stopPropagation();flip(e.currentTarget);}}
      onKeyDown={e=>{if(e.key.toLowerCase()==='f'){e.preventDefault();flip(e.currentTarget);}if(e.key.toLowerCase()==='i'&&definition){e.preventDefault();c.show(null);c.inspect(definition.code,instance?.face);}}}
      onClick={()=>{if(concealed)return;c.show(null);c.click(id);}}>
      {concealed?<CardBack kind={back}/>:<CardArt card={definition} face={instance?.face}/>}
      {selected&&<span className="table-selection">✓</span>}
    </button>
    {instance&&<div className="card-counter-row">{Object.entries(instance.tokens).filter(([key,value])=>value>0&&key!=='locationIndex').map(([key,value])=><span key={key} className={`counter-${key}`}>{value} {key}</span>)}{instance.exhausted&&<span>Exhausted</span>}</div>}
    {children}
  </div>;
}
export function HoverPreview({preview,catalog,text}:{preview:Preview|null;catalog:Catalog;text:boolean}) {
  if(!preview)return null;
  const card=preview.code?catalog.cards[preview.code]:undefined;
  const flipped=preview.face==='front'?'back':'front';
  const face=preview.reverse?flipped:preview.face;
  const generic=!card||(preview.reverse&&!card.faces.some(f=>f.id===face));
  const definition=card?.faces.find(f=>f.id===face);
  return <div className={`table-preview ${preview.x<window.innerWidth/2?'on-right':'on-left'} ${!generic&&face==='front'&&['investigator','act','agenda'].includes(card?.type??'')?'landscape':''}`} aria-hidden="true">
    {generic?<CardBack kind={preview.back}/>:<CardArt card={card} face={face}/>}
    {text&&!generic&&<div className="preview-rules"><strong>{definition?.name??card?.name}</strong><p>{cardText(definition?.text??'')}</p>{card?.raw.taboo_text?<p>Taboo: {String(card.raw.taboo_text)}</p>:null}<small>Effective rules · Taboo {catalog.rules?.tabooDate}</small></div>}
    <span className="preview-hint">Right-click / F: reverse · I: inspect</span>
  </div>;
}
