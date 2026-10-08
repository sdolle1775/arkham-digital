import draw from './assets/sounds/draw.wav';
import shuffle from './assets/sounds/shuffle.wav';
import carddrop from './assets/sounds/carddrop.wav';

const urls={draw,shuffle,carddrop};
type Sound=keyof typeof urls;
let context:AudioContext|undefined,enabled=true;
const buffers=new Map<Sound,AudioBuffer>(),playing=new Map<Sound,AudioBufferSourceNode>();
let loading:Promise<void>|undefined;
function unlock(){
  context??=new AudioContext();
  void context.resume().catch(()=>{});
  loading??=Promise.all(Object.entries(urls).map(async([name,url])=>{
    try{const bytes=await (await fetch(url)).arrayBuffer();buffers.set(name as Sound,await context!.decodeAudioData(bytes));}catch{/* Sound failure must not interrupt the game. */}
  })).then(()=>{});
}
/** Install before the first menu click, so setup audio is unlocked by that gesture. */
export function installTableAudio(){
  const gesture=()=>{try{unlock();}catch{/* Audio is optional on restricted browsers. */}};
  window.addEventListener('pointerdown',gesture);window.addEventListener('keydown',gesture);
  return()=>{window.removeEventListener('pointerdown',gesture);window.removeEventListener('keydown',gesture);};
}
export function setTableSound(enabledNow:boolean){enabled=enabledNow;if(!enabled)stopTableSounds();}
export function stopTableSounds(){for(const source of playing.values()){try{source.stop();}catch{/* Already ended. */}}playing.clear();}
export function playTableSound(name:Sound){
  const buffer=buffers.get(name);
  if(!enabled||document.hidden||context?.state!=='running'||!buffer)return;
  try{playing.get(name)?.stop();}catch{/* Already ended. */}
  const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;gain.gain.value=.2;
  source.connect(gain);gain.connect(context.destination);playing.set(name,source);
  source.onended=()=>{if(playing.get(name)===source)playing.delete(name);source.disconnect();gain.disconnect();};source.start();
}
