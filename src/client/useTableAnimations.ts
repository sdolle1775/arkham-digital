import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import type {SessionView,TableMotion} from '../shared/types';
import {animationSpeed,motionSound,nextTableMotion} from './table-motion';
import {playTableSound,setTableSound,stopTableSounds} from './table-sounds';
import playerBack from './assets/player_back.png';
import encounterBack from './assets/encounter_back.png';

type Rect={x:number;y:number;width:number;height:number};
type Move=Extract<TableMotion,{kind:'move'}>;
const rect=(element?:Element|null):Rect|undefined=>{const r=element?.getBoundingClientRect();return r&&r.width&&r.height?{x:r.x,y:r.y,width:r.width,height:r.height}:undefined;};
const cardSelector=(id:string)=>`[data-card-id="${CSS.escape(id)}"]`;
const zoneSelector=(id:string)=>`[data-table-zone="${CSS.escape(id)}"]`;
const seenSetup=new Set<string>();

class TableAnimator {
  private stopped=false;
  private animations=new Set<Animation>();
  private ghosts=new Set<HTMLElement>();
  private hidden=new Map<HTMLElement,string>();
  private tail=Promise.resolve();
  private pending=0;
  constructor(private root:HTMLElement,private speed:()=>number,private busy:(v:boolean)=>void){}
  private query(selector:string){return this.root.querySelector<HTMLElement>(selector);}
  private all(selector:string){return [...this.root.querySelectorAll<HTMLElement>(selector)];}
  private fallback():Rect {return {x:window.innerWidth/2-55,y:Math.max(90,window.innerHeight/2-90),width:110,height:150};}
  private zone(id:string):HTMLElement|null{return this.query(zoneSelector(id));}
  private anchor(id:string){const el=this.zone(id);return id.endsWith(':hand')?el?.querySelector<HTMLElement>('.table-card-wrap:last-child .table-card')??el:el;}
  private target(m:Move){return (m.cardId?this.query(cardSelector(m.cardId)):null)??this.anchor(m.to);}
  private hide(el:HTMLElement){if(!this.hidden.has(el)){this.hidden.set(el,el.style.opacity);el.style.opacity='0';}}
  private show(el:HTMLElement){if(this.hidden.has(el)){el.style.opacity=this.hidden.get(el)!;this.hidden.delete(el);}}
  private async animate(el:HTMLElement,frames:Keyframe[],duration:number,delay=0){
    if(this.stopped)return;
    const a=el.animate(frames,{duration,delay,easing:'cubic-bezier(.2,.75,.25,1)',fill:'both'});a.playbackRate=this.speed();this.animations.add(a);
    try{await a.finished;}catch{/* Cancellation on navigation/rollback is intentional. */}finally{a.cancel();this.animations.delete(a);}
  }
  respeed(){for(const a of this.animations)a.updatePlaybackRate(this.speed());}
  stop(){this.stopped=true;for(const a of this.animations)a.cancel();for(const el of this.ghosts)el.remove();for(const el of this.hidden.keys())this.show(el);stopTableSounds();this.busy(false);}
  private queue(run:()=>Promise<void>){
    this.pending++;this.busy(true);
    this.tail=this.tail.then(async()=>{if(!this.stopped&&!document.hidden)await run();}).catch(()=>{/* Cosmetic failures must leave a usable table. */}).finally(()=>{
      if(--this.pending===0){for(const el of this.hidden.keys())this.show(el);this.busy(false);}
    });
  }
  private async shuffle(pileId:string){
    const el=this.zone(pileId);if(!el||this.stopped)return;
    playTableSound('shuffle');
    await this.animate(el,[{transform:'translateX(0) rotate(0)'},{transform:'translateX(-12px) rotate(-7deg)',offset:.2},{transform:'translateX(13px) rotate(7deg)',offset:.4},{transform:'translateX(-8px) rotate(-4deg)',offset:.6},{transform:'translateX(6px) rotate(3deg)',offset:.8},{transform:'translateX(0) rotate(0)'}],650);
  }
  private async move(m:Move,source:Rect|undefined,destination:HTMLElement|null,forcedTarget?:Rect){
    if(this.stopped)return;
    const from=source??rect(this.anchor(m.from))??this.fallback(),to=forcedTarget??rect(destination)??rect(this.anchor(m.to))??this.fallback();
    const ghost=document.createElement('div');ghost.className='table-motion-card';ghost.setAttribute('aria-hidden','true');
    Object.assign(ghost.style,{left:`${from.x}px`,top:`${from.y}px`,width:`${to.width}px`,height:`${to.height}px`});
    const back=m.back==='player'?playerBack:encounterBack,face=m.code?`/api/assets/${encodeURIComponent(m.code)}/${m.face??'front'}`:back;
    const turn=document.createElement('div');turn.className='table-motion-turn';
    for(const [index,url] of [m.faceUpFrom?face:back,m.faceUpTo?face:back].entries()){
      const img=document.createElement('img');img.src=url;img.alt='';img.draggable=false;img.className=index?'motion-finish':'motion-start';turn.append(img);
    }
    ghost.append(turn);this.root.append(ghost);this.ghosts.add(ghost);
    const shouldFlip=m.faceUpFrom!==m.faceUpTo;
    if(!shouldFlip)turn.lastElementChild!.remove();
    playTableSound(motionSound(m));
    try{await Promise.all([
      this.animate(ghost,[{transform:`translate(0,0) scale(${from.width/to.width},${from.height/to.height})`,opacity:.8},{transform:`translate(${to.x-from.x}px,${to.y-from.y}px) scale(1)`,opacity:1}],400),
      ...(shouldFlip?[this.animate(turn,[{transform:'rotateY(0deg)'},{transform:'rotateY(180deg)'}],400)]:[])
    ]);}finally{ghost.remove();this.ghosts.delete(ghost);}
  }
  play(events:TableMotion[],previousRects:Map<string,Rect>){
    this.queue(async()=>{
      // Hide arriving faces until their travel completes. Pile tops retain their counts.
      for(const e of events)if(e.kind==='move'&&e.cardId){const el=this.query(cardSelector(e.cardId));if(el)this.hide(el);}
      const positions=new Map(previousRects);
      for(let index=0;index<events.length&&!this.stopped;index++){
        const e=events[index];
        if(e.kind==='shuffle'){await this.shuffle(e.pile);continue;}
        // Returning a searched/discard pile is one gathered stack, not a long deal.
        if(/:(deck|encounterDeck)$/.test(e.to)){
          const gathered:Move[]=[e];
          for(let n=index+1;n<events.length;n++){const next=events[n];if(next.kind!=='move'||next.from!==e.from||next.to!==e.to)break;gathered.push(next);}
          if(gathered.length>1){
            const destination=this.zone(e.to),to=rect(destination)??this.fallback();
            await Promise.all(gathered.map(m=>this.move(m,m.cardId?positions.get(m.cardId):undefined,destination,to)));
            for(const m of gathered)if(m.cardId)positions.set(m.cardId,to);
            index+=gathered.length-1;continue;
          }
        }
        const el=this.target(e),last=!events.slice(index+1).some(n=>n.kind==='move'&&e.cardId&&n.cardId===e.cardId);
        const destination=last?el:this.zone(e.to),to=rect(destination)??this.fallback();
        await this.move(e,e.cardId?positions.get(e.cardId):undefined,destination,to);
        if(e.cardId)positions.set(e.cardId,to);
        if(last&&el)this.show(el);
      }
    });
  }
  setup(view:SessionView,started:()=>void){
    const groups=[
      this.all('.scenario-table-row > *'),
      this.all('.table-connections,.table-location-zone'),
      this.all('.investigator-name,.investigator-table-row > *,.investigator-skills,.investigator-counters,.investigator-public-cards > *,.docked-hand header')
    ];
    const hands=this.all('.dock-hand-fan > .table-card-wrap');
    for(const el of [...groups.flat(),...hands])this.hide(el);
    this.queue(async()=>{
      // Let the fixed hand dock measure its available width before dealing.
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      if(this.stopped)return;started();
      for(const group of groups){
        if(this.stopped)return;
        await Promise.all(group.map(async(el,index)=>{await this.animate(el,[{opacity:0,translate:'0 -20px',scale:'.92'},{opacity:1,translate:'0 0',scale:'1'}],260,index*65);this.show(el);if(!this.stopped)playTableSound('carddrop');}));
      }
      await this.shuffle('scenario:encounterDeck');
      for(const id of view.setup.order){
        const i=view.investigators.find(player=>player.id===id);if(!i)continue;
        await this.shuffle(`${i.id}:deck`);
        const hand=this.zone(`${i.id}:hand`);
        for(const el of hand?.querySelectorAll<HTMLElement>('.table-card-wrap')??[]){
          const id=el.querySelector<HTMLElement>('[data-card-id]')?.dataset.cardId,card=id?view.cards[id]:undefined;
          await this.move({kind:'move',from:`${i.id}:deck`,to:`${i.id}:hand`,back:'player',faceUpFrom:false,faceUpTo:!!card,...(card?{cardId:card.id,code:card.code,face:card.face}:{})},undefined,el);
          this.show(el);
        }
      }
    });
  }
}

export function useTableAnimations(root:RefObject<HTMLElement|null>,view:SessionView,speed:number,sound:boolean){
  const [busy,setBusy]=useState(false),currentSpeed=useRef(speed),animator=useRef<TableAnimator|null>(null);
  const previous=useRef<SessionView|null>(null),positions=useRef(new Map<string,Rect>());
  currentSpeed.current=animationSpeed(speed);
  useLayoutEffect(()=>{setTableSound(sound);},[sound]);
  useEffect(()=>{animator.current?.respeed();},[speed]);
  useLayoutEffect(()=>{
    const el=root.current;if(!el)return;
    const setupKey=`${view.sessionId}:${view.campaign.scenarioNumber}`,setup=view.phase==='opening'&&!view.setup.completed.length;
    const old=previous.current,events=nextTableMotion(old,view);
    if(!animator.current||old&&view.checkpointId!==old.checkpointId&&!events.length){animator.current?.stop();const a:TableAnimator=new TableAnimator(el,()=>currentSpeed.current,v=>{if(animator.current===a)setBusy(v);});animator.current=a;}
    let seen=seenSetup.has(setupKey);try{seen ||= sessionStorage.getItem('arkham.table.setup.'+setupKey)==='seen';}catch{/* In-memory fallback. */}
    if(setup&&!seen)animator.current.setup(view,()=>{seenSetup.add(setupKey);try{sessionStorage.setItem('arkham.table.setup.'+setupKey,'seen');}catch{/* In-memory fallback. */}});
    else if(events.length)animator.current.play(events,positions.current);
    previous.current=view;
  },[view.checkpointId]);
  useLayoutEffect(()=>{const el=root.current;if(el)positions.current=new Map([...el.querySelectorAll<HTMLElement>('[data-card-id]')].flatMap(card=>{const r=rect(card);return r?[[card.dataset.cardId!,r] as const]:[];}));});
  useEffect(()=>{const visibility=()=>{if(document.hidden){animator.current?.stop();animator.current=null;}};document.addEventListener('visibilitychange',visibility);return()=>{document.removeEventListener('visibilitychange',visibility);animator.current?.stop();animator.current=null;};},[]);
  return busy;
}
