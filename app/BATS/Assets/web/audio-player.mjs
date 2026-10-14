// All bytes come through the existing local SAF interceptor. Never request a server.
export class LocalAudio {
 constructor({url,notify=()=>{},createContext=()=>new AudioContext(),fetcher=(...args)=>fetch(...args)}){
  Object.assign(this,{url,notify,createContext,fetcher});this.context=null;this.enabled=false;
  this.voiceVolume=1;this.bgmVolume=.35;this.cache=new Map();this.bytes=0;
  this.voiceToken=0;this.bgmToken=0;this.sceneToken=0;this.sceneAbort=new AbortController();this.blocked=false;
 }
 async enable(){
  if(!this.context){this.context=this.createContext();this.context.onstatechange=()=>console.log('HALL_AUDIO_STATE '+this.context.state);this.musicGain=this.context.createGain();this.voiceGain=this.context.createGain();this.musicGain.connect(this.context.destination);this.voiceGain.connect(this.context.destination);}
  this.enabled=true;if(!this.blocked)await this.context.resume();this.levels();this.notify('声音已开启');
 }
 levels(){if(this.context){this.voiceGain.gain.value=this.voiceVolume;this.musicGain.gain.value=this.bgmVolume*(this.voice?.node?.buffer ? .3:1);}}
 volumes(voice,bgm){this.voiceVolume=voice;this.bgmVolume=bgm;this.levels();}
 async pause(value){this.blocked=value;if(!this.context)return;if(value||!this.enabled)await this.context.suspend();else await this.context.resume();}
 async toggle(){if(this.enabled){this.enabled=false;await this.context?.suspend();this.notify('声音已关闭');}else await this.enable();}
 reset(){this.sceneToken++;this.sceneAbort.abort();this.sceneAbort=new AbortController();this.stopVoice();this.stopBgm();}
 stopVoice(){this.voiceToken++;if(this.voice){const active=this.voice;this.voice=null;active.node.onended=null;active.node.stop();active.node.disconnect();active.done(false);}this.levels();}
 stopBgm(){this.bgmToken++;this.musicPath=null;if(this.music){this.music.stop();this.music.disconnect();this.music=null;}}
 async buffer(path){
  if(!/^audio\/[a-z0-9_./-]+\.ogg$/i.test(path)||path.split('/').some(p=>p==='..'||p==='.'||!p))throw Error('无效音频路径');
  const cached=this.cache.get(path);if(cached){this.cache.delete(path);this.cache.set(path,cached);return cached;}
  const token=this.sceneToken,signal=this.sceneAbort.signal;
  const r=await this.fetcher(this.url(path),{signal});if(!r.ok)throw Error('本地音频缺失：'+path);
  const data=await r.arrayBuffer();if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const buffer=await this.context.decodeAudioData(data);
  if(token!==this.sceneToken)throw new DOMException('Cancelled','AbortError');
  const size=buffer.length*buffer.numberOfChannels*4;
  while(this.bytes+size>64*1024*1024&&this.cache.size){const [key,value]=this.cache.entries().next().value;this.cache.delete(key);this.bytes-=value.length*value.numberOfChannels*4;}
  if(size<=64*1024*1024&&!this.cache.has(path)){this.cache.set(path,buffer);this.bytes+=size;}
  return buffer;
 }
 async preload(paths){if(!this.enabled)return;for(const path of new Set(paths.filter(Boolean)))try{await this.buffer(path);}catch(e){if(e.name==='AbortError')return;this.notify(e.message);}}
 async bgm(path){
  if(path&&path===this.musicPath&&this.enabled)return;
  this.stopBgm();if(!path||!this.enabled)return;
  this.musicPath=path;
  const token=this.bgmToken;
  try{const buffer=await this.buffer(path);if(token!==this.bgmToken||!this.enabled)return;
   const node=this.context.createBufferSource();node.buffer=buffer;node.loop=true;node.connect(this.musicGain);this.music=node;node.start();this.levels();
   console.log('HALL_AUDIO_BGM '+JSON.stringify({path,duration:buffer.duration,state:this.context.state}));
  }catch(e){if(token===this.bgmToken){this.musicPath=null;if(e.name!=='AbortError')this.notify(e.message);}}
 }
 async voiceClip(path){
  this.stopVoice();if(!path||!this.enabled)return false;const token=this.voiceToken;
  try{const buffer=await this.buffer(path);if(token!==this.voiceToken||!this.enabled)return false;
   return await new Promise(resolve=>{const node=this.context.createBufferSource();node.buffer=buffer;node.connect(this.voiceGain);
    this.voice={node,done:resolve};node.onended=()=>{node.disconnect();if(this.voice?.node===node)this.voice=null;this.levels();console.log('HALL_AUDIO_ENDED '+path);resolve(true);};node.start();this.levels();
    console.log('HALL_AUDIO_VOICE '+JSON.stringify({path,duration:buffer.duration,state:this.context.state}));
   });
  }catch(e){if(e.name!=='AbortError'&&token===this.voiceToken)this.notify(e.message);return false;}
 }
}

export function voicePath(clip,locale){return clip?.voices?.[locale]||null;}
export function dialogLabel(id){return id.replace(/^CVGroup_UILobby(?:Special)?_/,'').replace(/^Idle/,'对话 ').replace(/^Enter/,'问候 ');}
export function localizedAnimation(name,names,locale){
 const base=name?.replace(/_CN$/,'');if(!base)return null;
 return locale==='cn'&&names.includes(base+'_CN')?base+'_CN':names.includes(base)?base:names.includes(name)?name:null;
}
