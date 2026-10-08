import type {Catalog,SessionView} from '../shared/types';
import {signed,testEquation,testOutcome,tokenName} from '../shared/test-results';
const glyphs:Record<string,string>={skull:'☠',cultist:'∴',tablet:'▤','elder-thing':'✹','elder-sign':'✦','auto-fail':'✕'};
export function TestResultPanel({session,catalog,openLog}:{session:SessionView;catalog:Catalog;openLog:()=>void}){
 const current=session.test,result=current?.result;
 if(!current?.awaitingResult||!result)return null;
 const actor=session.investigators.find(i=>i.id===result.actor),name=actor?catalog.cards[actor.investigatorCode].name:'Investigator';
 return <section className={'test-result-panel '+(result.success?'success':'failure')} aria-label="Chaos bag result" aria-live="polite">
  <header><strong className="test-result-title">{testOutcome(result)}</strong><button className="text-button" onClick={openLog}>Game log</button></header>
  <div className="test-result-context">{name} · {result.skill} · Difficulty {result.difficulty}</div>
  <div className="revealed-tokens">{result.tokens.map((token,n)=><span className={'revealed-token '+token} key={n} aria-label={tokenName(token)}><b>{glyphs[token]??token}</b><small>{glyphs[token]?tokenName(token):'Chaos token'}</small></span>)}<span className="token-total">Chaos <strong>{signed(result.tokenModifier)}</strong></span></div>
  <p className="test-equation">{testEquation(result)}</p><strong className="test-comparison">{result.total} vs {result.difficulty}{result.override?' · result changed by card effect':''}</strong>
  <p className="test-equation">{actor?.canControl?'Continue to resolve this test’s effects.':'Waiting for '+name+' to continue.'}</p>
 </section>;
}
