import type {SessionView,TableMotion} from '../shared/types';

export const animationSpeed=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(.25,Math.min(3,value)):1;
export function nextTableMotion(previous:Pick<SessionView,'checkpointId'|'revision'>|null,next:SessionView):TableMotion[] {
  if(!previous||next.checkpointId===previous.checkpointId||next.revision<=previous.revision||next.tableAnimation?.fromCheckpointId!==previous.checkpointId)return [];
  return next.tableAnimation.events;
}
export const motionSound=(motion:TableMotion):'draw'|'shuffle'|'carddrop'=>motion.kind==='shuffle'?'shuffle':/:(deck|encounterDeck)$/.test(motion.from)?'draw':'carddrop';
