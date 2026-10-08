import type {Effect} from '../../shared/types.js';
import {type Ctx,name,investigator} from './context.js';

export function effectLabel(x:Ctx,e:Effect):string {
 if(e.data?.label)return e.data.label;
 if(e.data?.prompt)return e.data.prompt;
 const who=e.actor?investigator(x,e.actor).name:'the investigator';
 if(e.type==='c-enemy-damage')return `Deal ${e.amount??1} damage to ${name(x,e.target!)}`;
 if(e.type==='c-damage')return `${who}: take ${e.amount??0} damage and ${e.data?.horror??0} horror`;
 if(e.type==='c-clue')return `${who}: discover ${e.amount??1} clue(s) at ${name(x,e.target!)}`;
 if(e.type==='c-draw')return `${who}: draw ${e.amount??1} card(s)`;
 if(e.type==='c-gain')return `${who}: gain ${e.amount??0} resource(s)`;
 if(e.type==='c-heal')return `${who}: heal ${e.amount??0} damage and ${e.data?.horror??0} horror`;
 if(e.type==='c-evade')return `Evade ${name(x,e.target!)}`;
 if(e.type==='c-return')return `Return ${name(x,e.source!)} to its owner's hand`;
 if(e.type==='c-drop-clue')return `${who}: drop ${e.amount??1} clue(s)`;
 if(e.source)return name(x,e.source);
 return 'Resolve scenario effect';
}
