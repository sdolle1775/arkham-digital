import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {Catalog,InvestigatorView,SessionView} from '../shared/types';
import {TableCard} from './TableCards';
import {displayCards,handFanLayout,type CardSort} from './table-model';
const colors=['#8bb6df','#df9e86','#cbb271','#a8c391'];
function DockedHand({investigator:i,session,catalog,sort,focus,active,visibleHands}:{investigator:InvestigatorView;session:SessionView;catalog:Catalog;sort:CardSort;focus:()=>void;active:boolean;visibleHands:number}){
 const area=useRef<HTMLDivElement>(null),[width,setWidth]=useState(300);
 useEffect(()=>{const el=area.current!,observer=new ResizeObserver(()=>setWidth(el.clientWidth));observer.observe(el);return()=>observer.disconnect();},[]);
 const cards=displayCards(i.hand,session,catalog,sort),layout=handFanLayout(width,i.handCount,visibleHands);
 return <section data-table-zone={`${i.id}:hand`} className={`docked-hand ${active?'focused':''}`} style={{'--seat-color':colors[i.seat-1]} as CSSProperties} aria-label={`P${i.seat} hand`}>
  <header><button onClick={focus}>P{i.seat} · {catalog.cards[i.investigatorCode].name}</button><div className="dock-skills" aria-label="Docked skill values">{(['willpower','intellect','combat','agility'] as const).map(skill=>{const {base,value}=i.skills[skill];return <span key={skill} className={value>base?'increased':value<base?'reduced':''} title={`${skill}: ${value} current (${base} printed)`}>{skill[0].toUpperCase()} <b>{value}</b></span>;})}</div><span title={!i.canControl?'Face-down hand':!i.mulliganComplete?'Opening hand':'Hand size'}>{i.handCount} cards</span></header>
  <div className="dock-hand-scroll" ref={area}><div className="dock-hand-fan" style={{width:layout.width}}>{Array.from({length:i.handCount},(_,n)=><TableCard key={cards[n]??'back-'+n} id={cards[n]??`hidden-${i.id}-${n}`} hidden={!i.canControl} style={{position:'absolute',left:n*layout.stride,zIndex:n}}/>)}</div></div>
 </section>;
}
export function HandDock({session,catalog,activeId,allHands,sort,select}:{session:SessionView;catalog:Catalog;activeId:string;allHands:boolean;sort:CardSort;select:(id:string)=>void}){
 const visible=session.investigators.filter(i=>allHands||i.id===activeId);
 return <div className="hand-dock" aria-label="Investigator hands">{visible.map(i=><DockedHand key={i.id} investigator={i} session={session} catalog={catalog} sort={sort} focus={()=>select(i.id)} active={i.id===activeId} visibleHands={visible.length}/>)}</div>;
}
