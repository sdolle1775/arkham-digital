import { useState, type Dispatch, type SetStateAction } from 'react';
import type { CampaignLog, CampaignLogEntry, Catalog, SessionView } from '../shared/types';
import { campaignRoute, logEntries, matchingEntry, normalizeItems, SCENARIO_NAMES } from '../shared/campaign-log';
import { Modal } from './components';
import './campaign-log.css';

export function LogDialog({session,catalog,host,busy,save,onClose}:{session:SessionView;catalog:Catalog;host:boolean;busy:boolean;save:(items:CampaignLogEntry[],records:CampaignLog['records'])=>void;onClose:()=>void}) {
  const [items,setItems]=useState(()=>logEntries(session.campaign.log));
  const [records,setRecords]=useState(()=>structuredClone(session.campaign.log.records));
  const suggestions=session.campaignProgress?.review?.entries??[];
  const [selected,setSelected]=useState(()=>new Set(suggestions));
  const entries=items.filter(i=>i.text.trim()).map(i=>i.text).join('\n'),route=campaignRoute(entries);
  const change=(id:string,key:keyof CampaignLog['records'][string],value:string|number)=>setRecords(r=>({...r,[id]:{...r[id],[key]:value}}));
  const suggested=()=>setItems(rows=>[...rows,...suggestions.filter(text=>selected.has(text)&&!rows.some(row=>matchingEntry(row.text)?.flag===matchingEntry(text)?.flag)).map(text=>({id:crypto.randomUUID(),text,scenario:session.campaign.scenarioNumber}))]);
  return <Modal title="Campaign log" eyebrow={session.campaign.name} onClose={onClose} wide><form onSubmit={e=>{e.preventDefault();save(normalizeItems(items),records);}}>
    {host&&suggestions.length>0&&<section className="resolution-log-prompt" aria-label="Resolution campaign entries"><h3>Scenario {session.campaign.scenarioNumber} resolution</h3><p>These entries match your resolution. Add them below, or enter the same strings manually.</p>{suggestions.map(text=><label key={text}><input type="checkbox" checked={selected.has(text)} onChange={()=>setSelected(old=>{const next=new Set(old);if(next.has(text))next.delete(text);else next.add(text);return next;})}/><span>{text}</span></label>)}<button type="button" className="button secondary small" disabled={busy||!selected.size} onClick={suggested}>Add selected entries</button></section>}
    <p className="fine-print">Green entries match campaign strings. Orange entries are custom notes. Completion entries choose the next scenario. Removing one makes that scenario available again.</p>
    <CampaignEntriesEditor items={items} setItems={setItems} readOnly={!host} busy={busy}/>
    <div className="campaign-route" role="status"><strong>{route.scenario?`Log selects Scenario ${route.scenario}: ${SCENARIO_NAMES[route.scenario-1]}`:'All three scenarios are marked complete'}</strong>{route.missing.map(message=><p key={message}>{message}</p>)}<p>Save the log, then use Prepare Scenario on the table. Investigator records below carry into setup. Use History to restore an exact earlier checkpoint.</p></div>
    <div className="log-investigators">{session.investigators.map(inv=><section key={inv.id} className="panel log-record"><h3>{catalog.cards[inv.investigatorCode]?.name||inv.investigatorCode}</h3><div className="record-numbers">{([['experience','Experience'],['physicalTrauma','Physical trauma'],['mentalTrauma','Mental trauma']] as const).map(([key,label])=><label key={key}>{label}<input type="number" min={0} max={key==='experience'?999:99} step={1} value={records[inv.id]?.[key]??0} readOnly={!host} required onChange={e=>change(inv.id,key,Math.max(0,Math.floor(Number(e.target.value))))}/></label>)}</div><label>Investigator notes<textarea rows={2} value={records[inv.id]?.notes||''} readOnly={!host} onChange={e=>change(inv.id,'notes',e.target.value)}/></label></section>)}</div>
    {host?<div className="modal-footer"><span className="fine-print">Saving creates a history checkpoint.</span><button className="button primary" disabled={busy}>Save log</button></div>:<p className="fine-print">The host maintains this shared campaign log.</p>}
  </form></Modal>;
}

export function CampaignEntriesEditor({items,setItems,readOnly=false,busy=false}:{items:CampaignLogEntry[];setItems:Dispatch<SetStateAction<CampaignLogEntry[]>>;readOnly?:boolean;busy?:boolean}) {
  const host=!readOnly;
  const add=(scenario:1|2|3|null,text='')=>setItems(rows=>[...rows,{id:crypto.randomUUID(),text,scenario}]);
  const edit=(id:string,text:string)=>setItems(rows=>rows.map(row=>row.id===id?{...row,text,scenario:matchingEntry(text)?.scenario??row.scenario}:row));
  return <div className="campaign-entry-sections">{([null,1,2,3] as const).map(scenario=>{
      const rows=items.filter(i=>i.scenario===scenario);return <section key={scenario??'general'} className={scenario?'campaign-scenario-box':'campaign-general'} aria-label={scenario?`Scenario ${scenario} log`:'General campaign entries'}>
        <header><h3>{scenario?`Scenario ${scenario} · ${SCENARIO_NAMES[scenario-1]}`:'General notes'}</h3>{host&&scenario&&rows.length>0&&<button type="button" className="text-button" disabled={busy} onClick={()=>setItems(old=>old.filter(i=>i.scenario!==scenario))}>Remove Scenario {scenario} entries</button>}</header>
        {rows.map((row,index)=>{const known=!!matchingEntry(row.text);return <div className={`campaign-entry ${known?'recognized':'custom'}`} key={row.id}>
          <span className="entry-kind" title={known?'Recognized campaign entry':'Custom note'}>{known?'Campaign':'Custom'}</span>
          <input aria-label={`${scenario?`Scenario ${scenario}`:'General'} entry ${index+1}`} maxLength={2000} value={row.text} readOnly={!host} onChange={e=>edit(row.id,e.target.value)} placeholder="Enter one campaign record"/>
          {host&&<button type="button" className="icon-button" aria-label={`Delete ${row.text||'empty entry'}`} disabled={busy} onClick={()=>setItems(old=>old.filter(i=>i.id!==row.id))}>×</button>}
        </div>;})}
        {host&&<button type="button" className="text-button add-log-entry" disabled={busy} onClick={()=>add(scenario)}>+ Add {scenario?`Scenario ${scenario}`:'general'} entry</button>}
      </section>;
    })}</div>;
}
