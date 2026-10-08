import type { TestResult } from './types.js';
export const signed=(value:number)=>value>=0?'+'+value:String(value);
export const tokenName=(token:string)=>({'auto-fail':'Auto-fail','elder-sign':'Elder sign','elder-thing':'Elder thing',skull:'Skull',cultist:'Cultist',tablet:'Tablet'}[token]??token);
export function testEquation(r:TestResult):string {
  return `${r.base} base ${signed(r.modifiers)} modifiers ${signed(r.bonus)} ability +${r.committed} committed ${signed(r.tokenModifier)} chaos = ${r.calculatedTotal}${r.base+r.modifiers+r.bonus+r.committed+r.tokenModifier<0?' (minimum 0)':''}`;
}
export function testOutcome(r:TestResult):string {
  return `${r.success?'SUCCESS':'FAILURE'} by ${Math.abs(r.margin)}${r.override?' — '+r.override:r.automaticFailure?' — automatic failure (total 0)':''}`;
}
