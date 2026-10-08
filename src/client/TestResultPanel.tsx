import {useEffect,useState} from 'react';
import type {Catalog,SessionView} from '../shared/types';
import {signed,testEquation,testOutcome,tokenName} from '../shared/test-results';
const glyphs:Record<string,string>={skull:'☠',cultist:'∴',tablet:'▤','elder-thing':'✹','elder-sign':'✦','auto-fail':'✕'};
export function TestResultPanel({session,catalog,openLog}:{session:SessionView;catalog:Catalog;openLog:()=>void}){
 const history=session.engine.testResults??[],latest=history.at(-1),current=session.test;
 const [selected,setSelected]=useState<string|null>(null),[expanded,setExpanded]=useState(true);
 const key=current?.id??latest?.id;
 useEffect(()=>{setSelected(null);setExpanded(true);},[key,current?.tokens.length]);
 const result=selected?history.find(r=>r.id===selected):current?.result??(!current?latest:undefined);
 const shown=result??current;if(!shown)return null;
 const actor=session.investigators.find(i=>i.id===shown.actor),index=result?history.findIndex(r=>r.id===result.id):-1;
 return <section className={`test-result-panel ${result?(result.success?'success':'failure'):''}`} aria-label="Chaos bag result" aria-live="polite">
  <header><button className="test-result-title" title={expanded?'Minimize test result':'Expand test result'} onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>{result?testOutcome(result):'Skill test in progress'} <span aria-hidden="true">{expanded?'▾':'▸'}</span></button><button className="text-button" onClick={openLog}>Game log</button></header>
  {expanded&&<><div className="test-result-context">{actor?catalog.cards[actor.investigatorCode].name:'Investigator'} · {shown.skill} · Difficulty {shown.difficulty}</div>
   <div className="revealed-tokens">{shown.tokens.map((token,n)=><span className={'revealed-token '+token} key={n} aria-label={tokenName(token)}><b>{glyphs[token]??token}</b><small>{glyphs[token]?tokenName(token):'Chaos token'}</small></span>)}{!shown.tokens.length&&<span className="token-waiting">Waiting for chaos tokens</span>}<span className="token-total">Chaos <strong>{signed(shown.tokenModifier)}</strong></span></div>
   {result?<><p className="test-equation">{testEquation(result)}</p><strong className="test-comparison">{result.total} vs {result.difficulty}{result.override?' · result changed by card effect':''}</strong></>:<p className="test-equation">Resolve the current choices to finish this test.</p>}
   {history.length>1&&<div className="test-result-navigation"><button disabled={index===0} onClick={()=>setSelected(history[index<0?history.length-1:index-1].id)}>← Previous test</button><span>{index>=0?`${index+1} / ${history.length}`:'Current test'}</span><button disabled={!selected} onClick={()=>setSelected(index+1<history.length?history[index+1].id:null)}>{index+1<history.length?'Next test →':'Current →'}</button></div>}
  </>}
 </section>;
}
