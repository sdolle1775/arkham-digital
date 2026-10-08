import type {GameCommand,GameState,PendingChoice} from '../shared/types.js';

/** A saved presentation boundary after result-changing windows, before result effects. */
export function pauseForTestResult(s:GameState,continuation:'c-test-step'|'test-step'):void {
  const t=s.test;
  if(!t?.result||s.pendingChoices.length)throw new Error('Cannot present an unfinished skill-test result.');
  s.resolutionStack.push({id:'effect-'+s.engine.nextId++,type:continuation,step:0});
  s.pendingChoices=[{id:'choice-'+s.engine.nextId++,type:'decision',investigatorId:t.actor,
    prompt:'Review the chaos result, then continue.',options:[],min:0,max:0,private:false,
    context:{kind:'test-result',testId:t.id}}];
}

export function acknowledgeTestResult(s:GameState,p:PendingChoice,command:GameCommand):void {
  const t=s.test;
  if(command.type!=='choose'||command.optionIds.length||!t?.result||t.id!==p.context?.testId||t.actor!==command.investigatorId||t.data?.resultReviewed)
    throw new Error('Continue the current skill-test result before resolving its effects.');
  (t.data??={}).resultReviewed=true;
}
