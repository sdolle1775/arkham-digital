import { useState } from 'react';
import type { GameCommand, PaymentView } from '../shared/types';

export function PaymentControls({payment,disabled,command}:{payment:PaymentView;disabled:boolean;command:(command:GameCommand)=>void}) {
  const defaults=()=>Object.fromEntries(payment.sources.map(s=>[s.id,String(payment.defaults.find(p=>p.sourceId===s.id)?.amount??0)]));
  const [amounts,setAmounts]=useState(defaults);
  const contributions=payment.sources.map(s=>({sourceId:s.id,amount:Number(amounts[s.id]??0)}));
  const total=contributions.reduce((n,p)=>n+p.amount,0);
  const valid=total===payment.cost&&contributions.every(p=>Number.isSafeInteger(p.amount)&&p.amount>=0&&p.amount<=payment.sources.find(s=>s.id===p.sourceId)!.available);
  return <div className="edge-payment" aria-label="Card payment">
    {payment.sources.map(source=><label key={source.id}><span>{source.label}<small>{source.available} available</small></span><input aria-label={`Spend from ${source.label}`} type="number" min={0} max={Math.min(source.available,payment.cost)} step={1} disabled={disabled} value={amounts[source.id]??'0'} onChange={e=>setAmounts(v=>({...v,[source.id]:e.target.value}))}/></label>)}
    <p role="status">{Number.isFinite(total)?total:0} / {payment.cost} allocated</p>
    <button className="edge-button primary-confirm" disabled={disabled||!valid} onClick={()=>command({type:'pay',investigatorId:payment.investigatorId,choiceId:payment.choiceId,contributions:contributions.filter(p=>p.amount>0)})}>Pay {payment.cost} & play</button>
    {payment.sources.length>1&&<button className="edge-button" disabled={disabled} onClick={()=>setAmounts(defaults())}>Use resources first</button>}
    <button className="edge-button" disabled={disabled} onClick={()=>command({type:'pass',investigatorId:payment.investigatorId,choiceId:payment.choiceId})}>Cancel</button>
  </div>;
}
