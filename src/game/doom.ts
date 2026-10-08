import type {Catalog,GameState} from '../shared/types.js';

/** Use the recorded engine's in-play zones, excluding stored and discarded cards. */
export function doomCardsInPlay(s:GameState):string[] {
  const chapter=s.rules.scriptVersion.startsWith('chapter2-');
  return Object.values(s.zones).filter(z=>chapter
    ?['assets','threat','identity','locations','enemies','attachments','agendas','acts'].includes(z.kind)
    :!['deck','hand','setAside','encounterDeck','encounterDiscard','discard','removed'].includes(z.kind)
  ).flatMap(z=>s.rules.scriptVersion==='chapter2-3'&&['acts','agendas'].includes(z.kind)?z.cards.slice(0,1):z.cards);
}

export function doomInPlay(s:GameState):number {return doomCardsInPlay(s).reduce((n,id)=>n+(s.cards[id].tokens.doom??0),0);}

export function agendaDoom(s:GameState,catalog?:Catalog) {
  const id=s.zones['scenario:agendas']?.cards[0],card=id?s.cards[id]:undefined;
  if(!card)return null;
  const definition=catalog?.cards[card.code],raw=card.face==='back'&&definition?.raw.linked_card
    ?definition.raw.linked_card as Record<string,unknown>:definition?.raw;
  return {agenda:card.tokens.doom??0,total:doomInPlay(s),threshold:card.face==='front'&&typeof raw?.doom==='number'?raw.doom:null};
}
