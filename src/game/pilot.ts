import { randomUUID } from 'node:crypto';
import type { Catalog, DeckRevision, GameState, RulesIdentity } from '../shared/types.js';
import { createGame } from './setup.js';
import { scripted } from './cards.js';
import { cardsIn, moveCard } from './zones.js';

export function createPilot(catalog:Catalog,rules:RulesIdentity,fixture:'opening'|'locations'='opening'):{state:GameState;decks:DeckRevision[]} {
  const decks:DeckRevision[]=['12001','12004'].map((investigatorCode,index)=>({id:randomUUID(),libraryId:randomUUID(),revision:1,source:'published',sourceCode:'pilot-'+index,name:'Developer fixture '+investigatorCode,investigatorCode,slots:investigatorCode==='12001'?{'12019':5,'12023':5,'12025':5,'12032':5,'12089':5,'12093':5,'12101':1}:{'12019':5,'12023':5,'12025':5,'12032':5,'12089':5,'12093':5,'12101':1},sideSlots:{},unsupported:[],importedAt:new Date().toISOString(),rules,purchaseXp:0}));
  const state=createGame({sessionId:randomUUID(),name:'Developer pilot — '+fixture,mode:'hotseat',difficulty:'standard',leadSeat:1,seats:decks.map((d,index)=>({deckRevisionId:d.id,playerName:index?'Joe':'Daniela'})),seed:fixture==='opening'?2401:2402,createdAt:new Date().toISOString()},catalog,decks,rules);
  state.engine.pilot=true;
  for(const id of [...cardsIn(state,'encounterDeck')])if(!scripted(state.cards[id].code))moveCard(state,id,'removed','scenario',catalog);
  if(fixture==='locations'){
    for(const cardCode of ['12116','12117']){const id=cardsIn(state,'setAside').find(id=>state.cards[id].code===cardCode)!;moveCard(state,id,'locations');state.cards[id].face='front';const d=catalog.cards[cardCode];state.cards[id].tokens.clues=(d.clues??0)*(d.cluesPerInvestigator?2:1);state.scenario.locations.push({cardId:id,x:cardCode==='12116'?380:760,y:0,connections:[]});}
    const [room,quad,dorm]=state.scenario.locations;room.connections=[dorm.cardId];dorm.connections=[room.cardId,quad.cardId];quad.connections=[dorm.cardId];
  }
  return {state,decks};
}
