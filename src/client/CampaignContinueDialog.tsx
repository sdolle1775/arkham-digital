import {useState} from 'react';
import type {Catalog,DeckRevision,SessionView} from '../shared/types';
import {Modal} from './components';
export function CampaignContinueDialog({session,decks,catalog,busy,close,manage,proceed}:{session:SessionView;decks:DeckRevision[];catalog:Catalog;busy:boolean;close:()=>void;manage:()=>void;proceed:(ids:string[])=>void}){
 const [selected,setSelected]=useState(()=>session.investigators.map(i=>decks.find(d=>d.id===i.deckRevisionId&&!d.sourceProblem)?.id??decks.find(d=>d.investigatorCode===i.investigatorCode&&!d.sourceProblem)?.id??''));
 const ready=selected.every(Boolean)&&new Set(selected.map(id=>decks.find(d=>d.id===id)?.investigatorCode)).size===selected.length;
 return <Modal title={'Prepare '+(session.campaign.scenarioNumber===1?'Smoke and Mirrors':'Queen of Ash')} eyebrow="Continue Brethren of Ash" onClose={close}>
  <p>Select stored ArkhamDB revisions for the next scenario. The latest Taboo is verified before continuing. Upgrades spend the XP in your campaign record; assigned weaknesses and story cards carry forward.</p>
  {session.investigators.map((i,index)=><label className="host-seat-field" key={i.id}>{i.name} · {session.campaign.log.records[i.id].experience} XP available<select value={selected[index]} onChange={e=>setSelected(selected.map((v,n)=>n===index?e.target.value:v))}><option value="">Choose a stored deck</option>{decks.map(d=><option key={d.id} value={d.id} disabled={!!d.sourceProblem||!!d.unsupported.length}>{catalog.cards[d.investigatorCode]?.name} — {d.name}{d.sourceProblem?' · refresh required':''}</option>)}</select></label>)}
  <p className="fine-print">Edit and share upgrades on ArkhamDB, then refresh the deck in your library. A replacement investigator begins with a 0 XP deck.</p>
  <div className="table-choice-footer"><button className="button subtle" onClick={manage}>Deck library</button><button className="button primary" disabled={busy||!ready} onClick={()=>proceed(selected)}>Prepare opening hands</button></div>
 </Modal>;
}
