import type { GameState as LegacyState } from '../shared/legacy-types.js';
import { BUILD_VERSION, type GameState, type Catalog, type RulesIdentity, type ZoneKind } from '../shared/types.js';
import { zone } from './zones.js';
import { validateGameState as validateLegacy } from './legacy-validation.js';
export const legacyRules=(catalog:Catalog):RulesIdentity=>({id:'legacy-setup-v1',tabooId:0,tabooDate:'unrecorded',tabooUpdated:'unrecorded',tabooHash:'unrecorded',catalogVersion:catalog.version,scriptVersion:'setup-v1'});
export function migrateState(old:LegacyState,catalog:Catalog,rules=legacyRules(catalog)):GameState {
  validateLegacy(old,catalog);
  const {effectQueue:_,investigators,scenario,cards,...rest}=structuredClone(old);
  const s:GameState={...rest,schemaVersion:2,buildVersion:BUILD_VERSION,rules,cards:{},zones:{},investigators:[],scenario:{id:scenario.id,name:'Spreading Flames',locations:scenario.locations,chaosBag:scenario.chaosBag},setup:{order:[],completed:[]},resolutionStack:[],queuedTests:[],test:null,engine:{pilot:false,round:1,phase:'investigation',activeInvestigatorId:null,nextId:1,actionDepth:0,log:[],limits:{},attacked:{},modifiers:[],experiencePenalty:{},outcomes:[]}};
  for(const [id,c]of Object.entries(cards))s.cards[id]={...c,owner:'scenario',controller:'scenario'};
  for(const i of investigators){
    const {deck,hand,openingSetAside,assets,threat,discard,...stats}=i;
    const cardId='identity-'+i.id;s.cards[cardId]={id:cardId,code:i.investigatorCode,face:'front',exhausted:false,tokens:{},owner:i.id,controller:i.id};
    s.investigators.push({...stats,cardId,eliminated:false,turnEnded:false});
    for(const [kind,ids]of Object.entries({deck,hand,openingSetAside,assets,threat,discard,identity:[cardId]})){
      zone(s,kind as ZoneKind,i.id).cards=ids;
      for(const id of ids){s.cards[id].owner=i.id;s.cards[id].controller=i.id;}
    }
  }
  for(const [kind,ids]of Object.entries({reference:[scenario.reference],acts:scenario.acts,agendas:scenario.agendas,encounterDeck:scenario.encounterDeck,encounterDiscard:scenario.encounterDiscard,setAside:scenario.setAside,victory:scenario.victory,locations:scenario.locations.map(l=>l.cardId),removed:[],enemies:[],attachments:[],resolving:[],committed:[]}))zone(s,kind as ZoneKind).cards=ids;
  const lead=s.investigators.findIndex(i=>i.id===s.leadInvestigatorId);
  s.setup.order=[...s.investigators.slice(lead),...s.investigators.slice(0,lead)].map(i=>i.id);
  s.setup.completed=s.investigators.filter(i=>i.mulliganComplete).map(i=>i.id);
  s.pendingChoices=s.setup.order.filter(id=>!s.setup.completed.includes(id)).map(id=>({id:'mulligan-'+id,type:'mulligan',investigatorId:id}));
  return s;
}
