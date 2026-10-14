export class BattleAudio {
 constructor(catalog,notify=()=>{}){this.catalog=catalog;this.notify=notify;this.locale=localStorage.getItem('voice-locale')==='jp'?'jp':'cn';this.enabled=localStorage.getItem('bats-battle-sound')!=='off';this.context=null;this.cache=new Map();this.nodes=new Set();this.queue=[];this.counter=new Map();this.gates=new Map();this.run=0;this.current=null;this.log=[];this.muted=false;}
 async enable(){if(!this.context){this.context=new AudioContext();this.gain=this.context.createGain();this.gain.connect(this.context.destination);}this.gain.gain.value=Number(localStorage.getItem('voice-volume')??1);if(this.enabled&&!this.muted)await this.context.resume();}
 async buffer(path){if(!/^battle-audio\/[a-z0-9_-]+\/[a-z0-9_-]+\.(ogg|wav)$/.test(path))throw Error('战斗音频路径无效');if(this.cache.has(path))return this.cache.get(path);const r=await fetch('/app/'+path);if(!r.ok)throw Error('本地战斗音频缺失：'+path);const b=await this.context.decodeAudioData(await r.arrayBuffer());this.cache.set(path,b);return b;}
 async preload(keys){if(!this.enabled)return;await this.enable();for(const key of keys)for(const list of Object.values(this.catalog.models[key]?.events||{}))for(const v of list[this.locale]||[])try{await this.buffer(v.path);}catch(e){this.notify(e.message);}}
 stop(){this.run++;this.queue=[];this.current=null;for(const node of this.nodes){node.onended=null;try{node.stop();}catch{}node.disconnect();}this.nodes.clear();}
 reset(){this.stop();this.gates.clear();}
 async pause(value){this.muted=value;if(this.context){if(value||!this.enabled)await this.context.suspend();else await this.context.resume();}}
 async switchLocale(){this.locale=this.locale==='cn'?'jp':'cn';localStorage.setItem('voice-locale',this.locale);this.stop();this.notify('已切换'+(this.locale==='cn'?'中配':'日配')+'，后续战斗语音生效');}
 cue(key,event,{priority=false,time=0}={}){
  if(!this.enabled||!this.context)return;const list=this.catalog.models[key]?.events[event]?.[this.locale];if(!list?.length){this.notify((this.locale==='cn'?'中配':'日配')+'缺少 '+key+' / '+event);return;}
  const gate=key+':'+event;if(!priority&&time<(this.gates.get(gate)??-Infinity)+(event==='damage'?6:event==='move'?10:event==='shot'?8:0))return;this.gates.set(gate,time);
  const n=this.counter.get(gate)||0;this.counter.set(gate,n+1);const request={path:list[n%list.length].path,key,event,locale:this.locale};
  if(priority)this.stop();if(this.queue.length<4)this.queue.push(request);this.next();
 }
 async next(){if(this.current||!this.queue.length)return;const item=this.current=this.queue.shift(),run=this.run;
  try{const buffer=await this.buffer(item.path);if(run!==this.run||this.current!==item||!this.enabled)return;const node=this.context.createBufferSource();node.buffer=buffer;node.connect(this.gain);this.nodes.add(node);node.onended=()=>{this.nodes.delete(node);node.disconnect();if(run===this.run){this.current=null;this.next();}};node.start();const record={...item,duration:buffer.duration,state:this.context.state};this.log.push(record);if(this.log.length>100)this.log.shift();console.log('BATS_AUDIO_VOICE '+JSON.stringify(record));}
  catch(e){if(run===this.run){this.current=null;this.notify(e.message);this.next();}}
 }
 dispose(){this.stop();this.context?.close();}
 async effect(cue){if(!this.enabled||!this.context)return;const run=this.run;try{const buffer=await this.buffer(cue.path);if(run!==this.run||!this.enabled)return;const node=this.context.createBufferSource();node.buffer=buffer;node.playbackRate.value=cue.pitch||1;const gain=this.context.createGain();gain.gain.value=cue.volume??1;node.connect(gain);gain.connect(this.gain);this.nodes.add(node);node.onended=()=>{this.nodes.delete(node);node.disconnect();gain.disconnect();};node.start();console.log('BATS_AUDIO_SFX '+JSON.stringify({path:cue.path,duration:buffer.duration,state:this.context.state}));}catch(e){if(run===this.run)this.notify(e.message);}}
}
