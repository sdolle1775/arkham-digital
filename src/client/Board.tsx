import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Catalog, GameCommand, PileView, SessionView } from '../shared/types';
import { CardArt, Modal } from './components';
import { CardBack, CardsContext, HoverPreview, TableCard, type Preview } from './TableCards';
import { cardActions, clampZoom, defaultPreferences, displayCards, fitCamera, relevantCards, tableLayout, type Camera, type ViewPreferences } from './table-model';
import { PaymentControls } from './PaymentControls';
import type { Inspect } from './Screens';
import './tabletop.css';

const seatColors=['#8bb6df','#df9e86','#cbb271','#a8c391'];
function loadPreferences():ViewPreferences {
  try {const v=JSON.parse(localStorage.getItem('arkham.table.preferences')??'{}');return {allHands:typeof v.allHands==='boolean'?v.allHands:true,pinned:typeof v.pinned==='boolean'?v.pinned:true,previews:typeof v.previews==='boolean'?v.previews:true,text:!!v.text,filter:['all','relevant','focused'].includes(v.filter)?v.filter:'all',sort:['table','name','type'].includes(v.sort)?v.sort:'table'};}catch{return defaultPreferences;}
}
type Spread={title:string;ids:string[];search?:boolean};
export function Board({session,catalog,busy,inspect,command,host,openLog,openHistory,openInvites,openSave,undo,exportSave,connection,mainMenu,openNextScenario}: {
  session:SessionView;catalog:Catalog;busy:boolean;inspect:Inspect;command:(command:GameCommand)=>void;host:boolean;
  openLog:()=>void;openHistory:()=>void;openInvites:()=>void;openSave:()=>void;undo:()=>void;exportSave:()=>void;connection:string;mainMenu:()=>void;openNextScenario:()=>void;
}) {
  const [prefs,setPrefs]=useState(loadPreferences),[settings,setSettings]=useState(false),[tools,setTools]=useState(false);
  const [activeId,setActiveId]=useState(session.investigators.find(i=>i.canControl)?.id??session.investigators[0].id);
  const [preview,setPreview]=useState<Preview|null>(null),[spread,setSpread]=useState<Spread|null>(null);
  const [actionCard,setActionCard]=useState<string|null>(null);
  const [selected,setSelected]=useState<string[]>([]),[minimized,setMinimized]=useState(false),[showBag,setShowBag]=useState(false),[gameLog,setGameLog]=useState(false);
  const viewport=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number;camera:Camera}|null>(null);
  const [size,setSize]=useState({width:window.innerWidth,height:window.innerHeight});
  const geometry=useMemo(()=>tableLayout(session),[session]);
  const cameraKey=`arkham.table.camera.${session.sessionId}.${session.mode}.${session.investigators.filter(i=>i.canControl).map(i=>i.id).join('-')}`;
  const [camera,setCamera]=useState<Camera>(()=>{try{const c=JSON.parse(localStorage.getItem(cameraKey)??'null');if(c&&[c.x,c.y,c.zoom].every(Number.isFinite)&&c.zoom>=.2&&c.zoom<=1.8)return c;}catch{/* use fit */}return fitCamera(geometry.width,geometry.height,size);});
  const choice=session.pendingChoices[0],active=session.investigators.find(i=>i.id===activeId)??session.investigators[0];
  const disabled=busy||connection!=='Connected';
  const eligible=useMemo(()=>new Set(choice?.type==='mulligan'?session.investigators.find(i=>i.id===choice.investigatorId)?.hand:choice?.options?.flatMap(o=>o.cardId?[o.cardId]:[])??[]),[choice,session.investigators]);
  const selectedCards=new Set(choice?.type==='mulligan'?selected:choice?.options?.filter(o=>selected.includes(o.id)).flatMap(o=>o.cardId?[o.cardId]:[])??[]);
  const relevant=useMemo(()=>relevantCards(session),[session]);
  const valid=!!choice&&(choice.type==='mulligan'||selected.length>=(choice.min??1)&&selected.length<=(choice.max??1));
  const popup=choice?.presentation==='popup'&&!minimized;
  const selectedDefinition=actionCard?catalog.cards[session.cards[actionCard]?.code]:undefined;
  const actions=cardActions(session,active.id,actionCard);
  const endTurn=session.allowedActions.find(a=>a.id.startsWith('end-turn|')&&a.investigatorId===session.engine.activeInvestigatorId);
  const chooseLabel=choice?.type==='mulligan'?(selected.length?`Replace ${selected.length}`:'Keep hand'):choice?.max===0?'Done':'Confirm';
  const prompt=choice?.prompt??(choice?.type==='mulligan'?'Choose cards to replace, or keep your opening hand.':selectedDefinition?selectedDefinition.name:session.phase==='opening'?'Waiting for opening hands':session.engine.blockedReason??(session.phase==='playing'?'Choose an action':'Setup complete · inspection available'));
  const playerName=(id:string)=>catalog.cards[session.investigators.find(i=>i.id===id)?.investigatorCode??'']?.name??'Investigator';
  useEffect(()=>{const el=viewport.current!;const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{const el=viewport.current!;const wheel=(e:WheelEvent)=>{
    e.preventDefault();setPreview(null);
    if(e.ctrlKey||e.metaKey){const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;setCamera(c=>{const z=clampZoom(c.zoom*Math.exp(-e.deltaY*.002));return {x:x-(x-c.x)*z/c.zoom,y:y-(y-c.y)*z/c.zoom,zoom:z};});}
    else setCamera(c=>({...c,x:c.x-(e.shiftKey?e.deltaY:e.deltaX),y:c.y-(e.shiftKey?0:e.deltaY)}));
  };el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);},[]);
  useEffect(()=>{try{localStorage.setItem('arkham.table.preferences',JSON.stringify(prefs));}catch{/* storage can be disabled */}},[prefs]);
  useEffect(()=>{const timer=setTimeout(()=>{try{localStorage.setItem(cameraKey,JSON.stringify(camera));}catch{/* storage can be disabled */}},200);return()=>clearTimeout(timer);},[camera,cameraKey]);
  useEffect(()=>{
    setSelected([]);setMinimized(false);setPreview(null);setActionCard(null);
    if(choice)setActiveId(choice.investigatorId);
    else if(session.engine.activeInvestigatorId&&session.investigators.some(i=>i.id===session.engine.activeInvestigatorId&&i.canControl))setActiveId(session.engine.activeInvestigatorId);
    setSpread(session.search?{title:'Search · '+playerName(session.search.investigatorId),ids:session.search.cards,search:true}:null);
  },[choice?.id,session.checkpointId]);
  useEffect(()=>{if(disabled)setPreview(null);},[disabled]);
  useEffect(()=>{const hide=()=>setPreview(null);window.addEventListener('blur',hide);return()=>window.removeEventListener('blur',hide);},[]);
  const preference=<K extends keyof ViewPreferences>(key:K,value:ViewPreferences[K])=>setPrefs(p=>({...p,[key]:value}));
  const focus=(x:number,y:number,zoom=.78)=>{setPreview(null);setCamera({x:size.width/2-x*zoom,y:size.height/2-y*zoom,zoom});};
  const focusMap=()=>{const positions=Object.values(geometry.positions),left=Math.min(...positions.map(p=>p.x)),top=Math.min(...positions.map(p=>p.y)),right=Math.max(...positions.map(p=>p.x))+240,bottom=Math.max(...positions.map(p=>p.y))+240;focus((left+right)/2,(top+bottom)/2,clampZoom(Math.min(.85,(size.width-340)/(right-left),(size.height-130)/(bottom-top))));};
  const focusInvestigator=(id:string)=>{setActiveId(id);setActionCard(null);const p=geometry.seats[id];focus(p.x+310,p.y+145);};
  const zoom=(factor:number,x=size.width/2,y=size.height/2)=>setCamera(c=>{const z=clampZoom(c.zoom*factor);return{x:x-(x-c.x)*z/c.zoom,y:y-(y-c.y)*z/c.zoom,zoom:z};});
  const selectOption=(id:string)=>{if(disabled)return;setSelected(ids=>ids.includes(id)?ids.filter(v=>v!==id):(choice?.max??1)===1?[id]:ids.length<(choice?.max??1)?[...ids,id]:ids);};
  const clickCard=(id:string)=>{
    if(choice?.type==='mulligan'&&eligible.has(id)){if(!disabled)setSelected(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);return;}
    const option=choice?.options?.find(o=>o.cardId===id);if(option){selectOption(option.id);return;}
    if(choice)return;
    const card=session.cards[id];if(card){setActionCard(id);const owner=session.investigators.find(i=>i.id===card.controller);if(owner?.canControl)setActiveId(owner.id);}
  };
  const confirm=()=>{if(!choice||!valid||disabled)return;if(choice.type==='mulligan')command({type:'mulligan',investigatorId:choice.investigatorId,cardIds:selected});else command({type:'choose',investigatorId:choice.investigatorId,choiceId:choice.id,optionIds:selected});};
  const pass=()=>{if(choice&&!disabled)command({type:'pass',investigatorId:choice.investigatorId,choiceId:choice.id});};
  const sorted=(ids:string[])=>displayCards(ids,session,catalog,prefs.sort);
  const attachments=(id:string)=>Object.values(session.cards).filter(c=>c.attachedTo===id).map(c=>c.id);
  const publicCards=(ids:string[],investigatorId:string)=>sorted(ids.filter(id=>prefs.filter==='all'||activeId===investigatorId||prefs.filter==='relevant'&&relevant.has(id)));
  const pile=(kind:PileView['kind'],owner='scenario')=>session.piles.find(p=>p.kind===kind&&p.owner===owner);
  const renderPile=(kind:PileView['kind'],label:string,owner='scenario')=>{
    const p=pile(kind,owner);const count=p?.count??0,ids=p?.cards??[],concealed=p?.visibility==='concealed';
    const top=kind==='discard'||kind==='encounterDiscard'?ids.at(-1):ids[0];
    const searchable=session.search?.investigatorId===owner&&kind==='deck';
    const pilePreview=(element:HTMLElement,reverse=false)=>{if(!count)return;setPreview({id:top??p!.id,code:top?session.cards[top]?.code:undefined,face:top?session.cards[top]?.face??'front':'back',reverse,back:owner==='scenario'?'encounter':'player',x:element.getBoundingClientRect().left});};
    return <div className={`table-pile ${top&&session.cards[top]?.face==='front'&&['acts','agendas'].includes(kind)?'landscape':''}`} data-pile={kind}><span className="table-caption">{label}</span>
      <button className={`pile-button ${searchable?'searching':''}`} aria-label={`${label}: ${count} cards${searchable?', reopen search':''}`} onClick={()=>{setPreview(null);if(searchable)setSpread({title:'Search · '+playerName(owner),ids:session.search!.cards,search:true});else if(top&&['acts','agendas'].includes(kind))clickCard(top);else if(!concealed&&ids.length)setSpread({title:label,ids});}}
        onMouseEnter={e=>pilePreview(e.currentTarget)} onFocus={e=>pilePreview(e.currentTarget)} onBlur={()=>setPreview(null)}
        onMouseLeave={()=>setPreview(null)} onContextMenu={e=>{e.preventDefault();pilePreview(e.currentTarget,preview?.id===(top??p?.id)?!preview?.reverse:true);}}
        onKeyDown={e=>{if(e.key.toLowerCase()==='f'){e.preventDefault();pilePreview(e.currentTarget,preview?.id===(top??p?.id)?!preview?.reverse:true);}if(e.key.toLowerCase()==='i'&&top){e.preventDefault();setPreview(null);inspect(session.cards[top].code,session.cards[top].face);}}}>
        {top?<CardArt card={catalog.cards[session.cards[top]?.code]} face={session.cards[top]?.face}/>:count||concealed?<CardBack kind={owner==='scenario'?'encounter':'player'}/>:<span className="empty-table-pile">—</span>}<span className="pile-count">{count}</span>
      </button></div>;
  };
  const promptButtons=choice?.presentation==='payment'&&session.payment?<PaymentControls key={session.payment.choiceId} payment={session.payment} disabled={disabled} command={command}/>:<>
    {choice&&<button className="edge-button primary-confirm" disabled={disabled||!valid} onClick={confirm}>{chooseLabel}{selected.length>0&&choice.type!=='mulligan'?` (${selected.length})`:''}</button>}
    {choice?.type==='decision'&&choice.min===0&&choice.max!==0&&<button className="edge-button" disabled={disabled} onClick={pass}>Pass</button>}
    {choice?.type==='decision'&&choice.options?.filter(o=>['pass','yes','no','cancel','done'].includes(o.id.toLowerCase())).map(o=><button className="edge-button" key={o.id} disabled={disabled} onClick={()=>command({type:'choose',investigatorId:choice.investigatorId,choiceId:choice.id,optionIds:[o.id]})}>{o.label}</button>)}
    {choice?.presentation==='popup'&&minimized&&<button className="edge-button" onClick={()=>setMinimized(false)}>Open choices</button>}
    {session.search&&!spread?.search&&<button className="edge-button" onClick={()=>setSpread({title:'Search · '+playerName(session.search!.investigatorId),ids:session.search!.cards,search:true})}>Open search</button>}
  </>;
  return <CardsContext.Provider value={{session,catalog,selected:selectedCards,legal:eligible,selecting:!!choice,activeCard:actionCard,inspect,click:clickCard,preview,show:setPreview}}>
    <main className="tabletop" aria-label="Arkham tabletop">
      <div className="tabletop-status"><span className="tabletop-wordmark">ARKHAM HORROR <b>DIGITAL</b></span><strong>{session.scenario.name}</strong><span>{session.phase==='opening'?'Opening hands':session.phase==='playing'?`${session.engine.phase} · Round ${session.engine.round}`:session.campaignProgress?.outcome??'Table ready'}</span><span className={connection==='Connected'?'connected':''}>{connection}</span><small>Autosaved · {session.revision}</small></div>
      <div className="tabletop-viewport" ref={viewport} tabIndex={0} aria-label="Pan and zoom the table"
        onPointerDown={e=>{if(e.button!==0||(e.target as HTMLElement).closest('button,input,select,a'))return;drag.current={x:e.clientX,y:e.clientY,camera};e.currentTarget.setPointerCapture(e.pointerId);setPreview(null);setActionCard(null);}}
        onPointerMove={e=>{if(drag.current)setCamera({...drag.current.camera,x:drag.current.camera.x+e.clientX-drag.current.x,y:drag.current.camera.y+e.clientY-drag.current.y});}}
        onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
        onKeyDown={e=>{if(e.target!==e.currentTarget)return;const directions:Record<string,[number,number]>={ArrowLeft:[80,0],ArrowRight:[-80,0],ArrowUp:[0,80],ArrowDown:[0,-80]};if(directions[e.key]){e.preventDefault();setCamera(c=>({...c,x:c.x+directions[e.key][0],y:c.y+directions[e.key][1]}));}if(e.key==='+'||e.key==='=')zoom(1.15);if(e.key==='-')zoom(1/1.15);}}>
        <div className="tabletop-world" style={{width:geometry.width,height:geometry.height,transform:`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`}}>
          <div className="scenario-table-row" style={{left:(geometry.width-1570)/2,top:80}}><div><span className="table-caption">Scenario</span><TableCard id={session.scenario.reference}/></div>
            {renderPile('agendas','Agenda')}{renderPile('acts','Act')}{renderPile('encounterDeck','Encounter deck')}{renderPile('encounterDiscard','Encounter discard')}
            <button className="table-chaos" onClick={()=>{setPreview(null);setShowBag(true);}} aria-label="Inspect chaos bag"><span>✦</span><strong>Chaos bag</strong><small>{session.scenario.chaosBag.length} tokens · {session.difficulty}</small></button>
            {session.campaign.scenarioNumber===2&&renderPile('underAct','Under the act')}{renderPile('victory','Victory display')}{renderPile('removed','Removed')}
          </div>
          <svg className="table-connections" width={geometry.width} height={geometry.height} aria-hidden="true">{session.scenario.locations.flatMap(l=>l.connections.filter(id=>l.cardId<id).map(id=>{const a=geometry.positions[l.cardId],b=geometry.positions[id];return b?<path key={l.cardId+id} d={`M ${a.x+75} ${a.y+100} L ${b.x+75} ${b.y+100}`}/>:null;}))}</svg>
          {session.scenario.locations.map((l,index)=>{const p=geometry.positions[l.cardId],nearby=[...attachments(l.cardId),...session.scenario.enemies.filter(id=>session.cards[id]?.tokens.locationIndex===index)];return <div key={l.cardId} className="table-location" style={{left:p.x,top:p.y}}>
            <TableCard id={l.cardId}/>{!!l.facedownCount&&<div className="location-facedown" aria-label={`${l.facedownCount} hidden card beneath this location`}><CardBack kind="encounter"/><small>{l.facedownCount} beneath</small></div>}<div className="table-markers">{session.investigators.filter(i=>i.locationId===l.cardId).map(i=><button style={{'--seat-color':seatColors[i.seat-1]} as CSSProperties} key={i.id} onClick={()=>focusInvestigator(i.id)} title={`${playerName(i.id)} · ${i.name}`}>P{i.seat}</button>)}</div>
            <div className="location-card-spread">{nearby.map(id=><TableCard id={id} key={id}/>)}</div>
          </div>;})}
          {session.investigators.map(i=>{const p=geometry.seats[i.id],cards=publicCards([...i.assets,...i.threat],i.id),hand=sorted(i.hand);return <div className={`table-investigator ${active.id===i.id?'focused':''}`} key={i.id} style={{left:p.x,top:p.y,'--seat-color':seatColors[i.seat-1]} as CSSProperties}>
            <div className="investigator-public-cards" style={{top:-geometry.publicRows*260-40}}>{cards.flatMap(id=>[id,...attachments(id)]).map(id=><div key={id}><span className="table-caption">{i.threat.includes(id)?'Threat':session.cards[id].attachedTo?'Attached':'Asset'}</span><TableCard id={id}/></div>)}</div>
            <div className="investigator-name"><button onClick={()=>setActiveId(i.id)}>P{i.seat} · {playerName(i.id)}</button><span>{i.name}{session.leadInvestigatorId===i.id?' · Lead':''}{i.canControl?' · You':''}</span></div>
            <div className="investigator-table-row"><TableCard id={i.cardId}/>{renderPile('deck','Deck',i.id)}{renderPile('discard','Discard',i.id)}</div>
            <div className="investigator-counters"><span title="Resources">{i.resources} <small>Resources</small></span><span>{i.damage}/{i.health} <small>Damage</small></span><span>{i.horror}/{i.sanity} <small>Horror</small></span><span>{i.actions} <small>Actions</small></span><span>{i.clues} <small>Clues</small></span></div>
            {(prefs.allHands||active.id===i.id)&&<div className="table-hand"><div className="hand-caption"><span>HAND · {i.handCount}</span><span>{i.canControl?(i.mulliganComplete?'':'Opening hand'):'Face down'}</span></div><div className="hand-fan" style={{height:Math.max(1,Math.ceil(i.handCount/10))*230}}>{Array.from({length:i.handCount},(_,index)=>{const rowCount=Math.min(10,i.handCount-Math.floor(index/10)*10),stride=rowCount>1?Math.min(152,490/(rowCount-1)):0;return <TableCard key={hand[index]??'hidden-'+index} id={hand[index]??`hidden-${i.id}-${index}`} hidden={!i.canControl} style={{position:'absolute',left:index%10*stride,top:Math.floor(index/10)*230,zIndex:index%10}}/>;})}</div></div>}
          </div>;})}
          {session.piles.filter(p=>['committed','resolving'].includes(p.kind)&&p.cards.length).map((p,index)=><div className="table-resolving" key={p.id} style={{left:90+index*350,top:350}}><span className="table-caption">{p.kind}</span><div>{p.cards.map(id=><TableCard key={id} id={id}/>)}</div></div>)}
        </div>
      </div>
      <nav className={`table-edge left-edge ${prefs.pinned?'pinned':''}`} aria-label="Table view controls">
        {!prefs.pinned&&<button className="edge-handle" aria-label="Show view controls">View</button>}
        <div className="edge-buttons">{session.investigators.map(i=><button className={`edge-button ${active.id===i.id?'active':''}`} key={i.id} title={`Focus ${playerName(i.id)}`} onClick={()=>focusInvestigator(i.id)}>P{i.seat}</button>)}
          <button className={`edge-button ${prefs.allHands?'active':''}`} title="Show all hands or focused hand" onClick={()=>preference('allHands',!prefs.allHands)}>Hands: {prefs.allHands?'All':'One'}</button>
          <button className="edge-button" title="Cycle All / Relevant / Focused cards" onClick={()=>preference('filter',prefs.filter==='all'?'relevant':prefs.filter==='relevant'?'focused':'all')}>{prefs.filter==='all'?'All cards':prefs.filter==='relevant'?'Relevant':'Focused'}</button>
          <button className="edge-button" onClick={()=>setCamera(fitCamera(geometry.width,geometry.height,size))}>Fit table</button>
          <button className="edge-button" onClick={focusMap}>Map</button>
          <div className="edge-zoom"><button aria-label="Zoom out" onClick={()=>zoom(1/1.15)}>−</button><span>{Math.round(camera.zoom*100)}%</span><button aria-label="Zoom in" onClick={()=>zoom(1.15)}>+</button></div>
          <button className={`edge-button ${prefs.pinned?'active':''}`} aria-pressed={prefs.pinned} onClick={()=>preference('pinned',!prefs.pinned)}>Pin</button>
          <button className="edge-button" aria-expanded={settings} onClick={()=>setSettings(!settings)}>View settings</button>
        </div>
        {settings&&<div className="edge-popover"><label><input type="checkbox" checked={prefs.previews} onChange={e=>preference('previews',e.target.checked)}/>Card previews</label><label><input type="checkbox" checked={prefs.text} onChange={e=>preference('text',e.target.checked)}/>Effective text</label><label>Display order<select value={prefs.sort} onChange={e=>preference('sort',e.target.value as ViewPreferences['sort'])}><option value="table">Table order</option><option value="name">Card name</option><option value="type">Card type</option></select></label><p>Drag empty table to pan. Ctrl + wheel to zoom. F flips a preview; I opens details.</p></div>}
      </nav>
      <div className="table-edge right-edge" aria-label="Prompt and table controls">
        <div className="edge-prompt" role="status"><small>{choice?playerName(choice.investigatorId):playerName(active.id)}</small><p>{prompt}</p>{choice&&choice.presentation!=='payment'&&<span>{choice.type==='mulligan'?`${selected.length} to replace`:`${selected.length} selected${choice.max?` · ${choice.min??1}–${choice.max}`:''}`}</span>}{session.test&&<span>{session.test.skill} vs {session.test.difficulty} · {session.test.tokens.join(', ')||'Test in progress'}</span>}</div>
        {promptButtons}
        {!choice&&<div className="edge-actions">{actionCard&&!actions.length&&<p className="edge-empty">No available actions for this card.</p>}{actions.map(a=><button className="edge-button" key={a.id} disabled={disabled} onClick={()=>command({type:'action',investigatorId:a.investigatorId,actionId:a.id})}>{a.label}</button>)}{actionCard&&<button className="edge-button" onClick={()=>setActionCard(null)}>All actions</button>}</div>}
        {host&&session.campaignProgress?.canContinue&&<button className="edge-button active" disabled={disabled} onClick={openNextScenario}>Next scenario</button>}
        <button className="edge-button end-turn" disabled={disabled||!endTurn} title={endTurn?`End ${playerName(endTurn.investigatorId)}’s turn`:choice?'Resolve the current choice first':'Waiting for your investigator’s turn'} onClick={()=>{if(endTurn)command({type:'action',investigatorId:endTurn.investigatorId,actionId:endTurn.id});}}>End turn</button>
        <button className="edge-button table-tools-toggle" aria-expanded={tools} onClick={()=>setTools(!tools)}>Table menu</button>
        {tools&&<div className="edge-tools"><button className="edge-button" onClick={openLog}>Campaign log</button><button className="edge-button" onClick={()=>setGameLog(true)}>Game log</button>{host&&<><button className="edge-button" disabled={disabled} onClick={undo}>Undo</button><button className="edge-button" onClick={openHistory}>History</button><button className="edge-button" onClick={openSave}>Save</button><button className="edge-button" disabled={busy} onClick={exportSave}>Export</button><button className="edge-button" onClick={openInvites}>Players & sharing</button><button className="edge-button" onClick={mainMenu}>Main menu</button></>}</div>}
      </div>
      <div className="tabletop-help">Drag to pan · Ctrl + wheel to zoom · Hover to inspect · Right-click to preview reverse</div>
      {spread&&<div className="table-spread" aria-label={spread.title}><header><div><strong>{spread.title}</strong><small>{spread.search?'Full search display · choose highlighted cards':`${spread.ids.length} visible cards`}</small></div><button className="edge-button" onClick={()=>{setSpread(null);setPreview(null);}}>{spread.search?'Minimize':'Close'}</button></header><div className="spread-cards">{(spread.search?spread.ids:sorted(spread.ids)).map(id=><TableCard key={id} id={id}/>)}</div>{spread.search&&<p className="spread-note">{choice?.max===0?'No eligible cards. Select Done to continue.':`Select ${choice?.min??0}–${choice?.max??1} cards, then Confirm.`}</p>}</div>}
      {prefs.previews&&<HoverPreview preview={preview} catalog={catalog} text={prefs.text}/>}
      {popup&&choice&&<Modal title={choice.prompt??'Choose an option'} eyebrow={playerName(choice.investigatorId)} onClose={()=>{setMinimized(true);setPreview(null);}}><div className="table-choice-options">{choice.options?.map(o=><button className={`choice-option ${selected.includes(o.id)?'selected':''}`} key={o.id} aria-pressed={selected.includes(o.id)} disabled={disabled} onMouseEnter={e=>{const card=o.cardId?session.cards[o.cardId]:undefined;if(card)setPreview({id:card.id,code:card.code,face:card.face,reverse:false,x:e.currentTarget.getBoundingClientRect().left});}} onMouseLeave={()=>setPreview(null)} onContextMenu={e=>{e.preventDefault();const card=o.cardId?session.cards[o.cardId]:undefined;if(card)setPreview({id:card.id,code:card.code,face:card.face,reverse:preview?.id===card.id?!preview.reverse:true,x:e.currentTarget.getBoundingClientRect().left});}} onClick={()=>selectOption(o.id)}>{o.cardId&&session.cards[o.cardId]&&<CardArt card={catalog.cards[session.cards[o.cardId].code]} face={session.cards[o.cardId].face} compact/>}<span>{o.label}</span><b>{selected.includes(o.id)?'✓':'○'}</b></button>)}</div><div className="table-choice-footer"><button className="button subtle" onClick={()=>setMinimized(true)}>Minimize</button><button className="button primary" disabled={disabled||!valid} onClick={confirm}>{chooseLabel}</button></div>{prefs.previews&&<HoverPreview preview={preview} catalog={catalog} text={prefs.text}/>}</Modal>}
      {showBag&&<Modal title="Chaos bag" eyebrow={session.difficulty} onClose={()=>setShowBag(false)}><div className="chaos-bag">{session.scenario.chaosBag.map((token,index)=><span className={`bag-token ${token}`} key={index}><strong>{token}</strong></span>)}</div></Modal>}
      {gameLog&&<Modal title="Game log" eyebrow={`Round ${session.engine.round}`} onClose={()=>setGameLog(false)}><ol className="table-game-log">{session.engine.log.map((line,index)=><li key={index}>{line}</li>)}</ol>{!session.engine.log.length&&<p>No gameplay events yet.</p>}</Modal>}
    </main>
  </CardsContext.Provider>;
}
