import { useEffect, useState } from 'react';
import type { GameCommand, SessionView } from '../shared/types';
export function PilotControls({session,busy,command,inspect}:{session:SessionView;busy:boolean;command:(c:GameCommand)=>void;inspect:(code:string,face?:'front'|'back')=>void}) {
  const choice=session.pendingChoices.find(c=>c.type==='decision');
  const [selected,setSelected]=useState<string[]>([]);
  useEffect(()=>setSelected([]),[choice?.id]);
  if(!session.engine.pilot)return null;
  const valid=choice&&selected.length>=(choice.min??1)&&selected.length<=(choice.max??1);
  return <section className="pilot-controls panel"><div className="eyebrow">DEVELOPER PILOT · {session.engine.phase} · ROUND {session.engine.round}</div><p className="fine-print">Rules: ArkhamDB Taboo {session.rules.tabooDate} · {session.rules.scriptVersion}</p>
    {session.engine.blockedReason&&<p className="inline-warning">{session.engine.blockedReason} Restore an earlier checkpoint or open another fixture.</p>}
    {session.test&&<p>Skill test: {session.test.skill} against {session.test.difficulty}. Tokens: {session.test.tokens.join(', ')||'Not revealed'}</p>}
    {choice?<div className="pilot-choice"><h2>{choice.prompt}</h2><p>{session.investigators.find(i=>i.id===choice.investigatorId)?.name}{choice.private?' · Private choice':''}</p><div className="pilot-options">{choice.options?.map(o=><label key={o.id}><input type={(choice.max??1)===1?'radio':'checkbox'} name={choice.id} checked={selected.includes(o.id)} onChange={()=>setSelected((choice.max??1)===1?[o.id]:selected.includes(o.id)?selected.filter(id=>id!==o.id):[...selected,o.id])}/>{o.label}{o.cardId&&session.cards[o.cardId]&&<button type="button" className="button subtle small" onClick={event=>{event.preventDefault();const card=session.cards[o.cardId!];inspect(card.code,card.face);}}>Inspect</button>}</label>)}</div><button className="button primary" disabled={busy||!valid} onClick={()=>command({type:'choose',investigatorId:choice.investigatorId,choiceId:choice.id,optionIds:selected})}>Confirm choice</button>{choice.min===0&&<button className="button subtle" disabled={busy} onClick={()=>command({type:'pass',investigatorId:choice.investigatorId,choiceId:choice.id})}>Pass</button>}</div>:<div className="pilot-actions">{session.allowedActions.map(a=><button key={a.investigatorId+':'+a.id} className="button secondary small" disabled={busy} onClick={()=>command({type:'action',investigatorId:a.investigatorId,actionId:a.id})}>{session.investigators.find(i=>i.id===a.investigatorId)?.name}: {a.label}</button>)}{session.phase==='playing'&&!session.allowedActions.length&&<p>Waiting for another investigator’s choice.</p>}</div>}
    <details><summary>Game log</summary><ol className="pilot-log">{session.engine.log.map((line,index)=><li key={index}>{line}</li>)}</ol></details>
  </section>;
}
