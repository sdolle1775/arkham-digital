import {useState} from 'react';
import type {Catalog,DeckRevision,SessionView} from '../shared/types';
import {SCENARIO_NAMES} from '../shared/campaign-log';
import {Modal} from './components';
export function CampaignContinueDialog({session,decks,catalog,busy,close,manage,proceed}:{session:SessionView;decks:DeckRevision[];catalog:Catalog;busy:boolean;close:()=>void;manage:()=>void;proceed:(ids:string[])=>void}){
 const [selected,setSelected]=useState(()=>session.investigators.map(i=>decks.find(d=>d.id===i.deckRevisionId&&!d.sourceProblem)?.id??decks.find(d=>d.investigatorCode===i.investigatorCode&&!d.sourceProblem)?.id??''));
 const target=session.campaignProgress?.nextScenario??1;
 const ready=!(session.campaignProgress?.missing.length)&&selected.every(Boolean)&&new Set(selected.map(id=>decks.find(d=>d.id===id)?.investigatorCode)).size===selected.length;
 return <Modal title={'Prepare '+SCENARIO_NAMES[target-1]} eyebrow="Continue Brethren of Ash" onClose={close}>
  <p>Your campaign log selects Scenario {target}. Select stored ArkhamDB revisions to prepare it. The latest Taboo is verified before continuing. Upgrades spend the XP in your campaign record; assigned weaknesses and story cards carry forward. Preparing replaces the active table and preserves it in History.</p>{session.campaignProgress?.missing.map(message=><p role="alert" key={message}>{message}</p>)}
  {session.investigators.map((i,index)=><label className="host-seat-field" key={i.id}>{i.name} · {session.campaign.log.records[i.id].experience} XP available<select value={selected[index]} onChange={e=>setSelected(selected.map((v,n)=>n===index?e.target.value:v))}><option value="">Choose a stored deck</option>{decks.map(d=><option key={d.id} value={d.id} disabled={!!d.sourceProblem||!!d.unsupported.length}>{catalog.cards[d.investigatorCode]?.name} — {d.name}{d.sourceProblem?' · refresh required':''}</option>)}</select></label>)}
  <p className="fine-print">Edit and share upgrades on ArkhamDB, then refresh the deck in your library. A replacement investigator begins with a 0 XP deck.</p>
  <div className="table-choice-footer"><button className="button subtle" onClick={manage}>Deck library</button><button className="button primary" disabled={busy||!ready} onClick={()=>proceed(selected)}>Prepare opening hands</button></div>
 </Modal>;
}
