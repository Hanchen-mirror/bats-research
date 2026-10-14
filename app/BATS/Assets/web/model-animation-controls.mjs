import {decodeSkin,sampleWorlds,sampleVisibility,skinMesh,expandSkin} from './model-animation.mjs';
import {combatPreviewSequence} from './unit-motion.mjs';
const labels={Normal_Idle:'普通待机',Move_Ing:'移动循环',Normal_Attack_Start:'攻击准备',Normal_Attack_Ing:'普通攻击',Normal_Attack_End:'攻击收尾',Formation_Idle:'编队待机',Cafe_Idle:'咖啡厅待机',Cafe_Walk:'咖啡厅行走',Preview_Sequence:'移动与普攻衔接预演'};
export async function loadAnimation(key,fetchOK,parts,gl,changed){
 const state=document.getElementById('animation-status'),picker=document.getElementById('animation-picker'),play=document.getElementById('animation-play'),loop=document.getElementById('animation-loop'),seek=document.getElementById('animation-seek'),speed=document.getElementById('animation-speed'),clock=document.getElementById('animation-time');
 const catalog=await(await fetch('/app/animation-catalog.json')).json(),entry=catalog.models[key];
 if(entry?.status!=='ready'){state.textContent='此学生的原始动作尚未接入，本版保留静态预览。';return null;}
 const data=await(await fetchOK('animation.json')).json(),meshes=[];
 if(data.schemaVersion!==1||data.id!==key)throw Error('动作资源版本或角色不匹配');
 for(const m of data.meshes)meshes.push(decodeSkin(m,await(await fetchOK(m.buffer)).arrayBuffer()));
 const links=[];for(const l of data.parts){const indices=new Uint32Array(await(await fetchOK(l.indices)).arrayBuffer());if(indices.length!==parts[l.part].vertices)throw Error('动作材质分组长度不匹配');links.push({...l,indices,output:new Float32Array(indices.length*5)});const m=meshes[l.mesh];let n=m.node,controlled=false;while(n>=0){controlled ||= data.clips.some(c=>c.tracks.some(t=>t.node===n&&t.property==='active'));n=data.nodes[n].parent;}parts[l.part].animationEligible=parts[l.part].sourceActive!==false||controlled;}
 let clip=null,time=0,playing=true,dirty=true,accum=1/30;const original=parts.map(p=>p.originalValues.slice());
 for(const c of data.clips)picker.add(new Option((labels[c.kind]||c.kind)+(c.unresolvedBindings.length||(c.unsupportedProperties||[]).length?' · 细节待核查':''),c.kind));
 let sequence=null;const roles=['Normal_Idle','Move_Ing','Normal_Attack_Start','Normal_Attack_Ing','Normal_Attack_End'];
 if(roles.every(kind=>data.clips.some(c=>c.kind===kind))){const motion=combatPreviewSequence(data);sequence={kind:'Preview_Sequence',duration:motion.duration,motion,unresolvedBindings:data.clips.flatMap(c=>c.unresolvedBindings),unsupportedProperties:data.clips.flatMap(c=>c.unsupportedProperties||[])};picker.add(new Option(labels.Preview_Sequence,'Preview_Sequence'));}
 function poseAt(c,t){return c.motion?c.motion.sample(t):{kind:c.kind,worlds:sampleWorlds(data,c,t),visibility:sampleVisibility(data,c,t)};}
 for(const el of [picker,play,seek,speed,loop])el.disabled=false;
 function updateClock(){clock.textContent=clip?`${time.toFixed(2)} / ${clip.duration.toFixed(2)} 秒`:'静态姿态';clock.dataset.time=String(time);if(clip)seek.value=String(time/clip.duration*1000);play.textContent=playing?'暂停':'播放';}
 const envelopes=new Map();
 function clipEnvelope(c){
  if(envelopes.has(c.kind))return envelopes.get(c.kind);
  const boxes=links.map(()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],visible:false}));
  const times=c.motion?c.motion.timeline.flatMap(s=>[0,.15,.35,.65,1].map(f=>s.start+s.duration*f)):[0,.15,.35,.65,1].map(f=>c.duration*f);
  for(const t of times){
   const {worlds,visibility}=poseAt(c,t);for(const m of meshes)skinMesh(m,worlds);
   for(let n=0;n<links.length;n++){const l=links[n],m=meshes[l.mesh],b=boxes[n];b.visible ||= visibility[m.node];for(const i of l.indices)for(let a=0;a<3;a++){const v=m.posed[i*3+a];b.min[a]=Math.min(b.min[a],v);b.max[a]=Math.max(b.max[a],v);}}
  }
  envelopes.set(c.kind,boxes);return boxes;
 }
 function select(){clip=picker.value==='Preview_Sequence'?sequence:data.clips.find(c=>c.kind===picker.value)||null;time=0;playing=true;dirty=true;const active=!!clip;if(clip){const boxes=clipEnvelope(clip);for(let n=0;n<links.length;n++){const p=parts[links[n].part];p.bounds=boxes[n];p.animationEnvelopeVisible=boxes[n].visible;}}else for(const p of parts)p.bounds=p.originalBounds;for(const el of [play,seek,speed,loop])el.disabled=!active;changed(active);if(!active)for(let i=0;i<parts.length;i++){gl.bindBuffer(gl.ARRAY_BUFFER,parts[i].buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,original[i]);}state.dataset.kind=clip?.kind||'static';state.textContent=clip?`${labels[clip.kind]} · 原始骨骼动作`+(clip.unresolvedBindings.length?` · ${clip.unresolvedBindings.length} 条曲线在当前模型中无匹配节点，细节待核查`:' · 目标路径已全部关联'):'静态姿态 · 可分开展示配件';if(clip&&(clip.unsupportedProperties||[]).length)state.textContent+=' · 部分表情或材质属性尚未还原';if(clip&&(data.followers||[]).length)state.textContent+=' · 光环跟随预览，原作缓动待还原';if(clip?.motion)state.textContent+=' · 本地动作衔接，不产生战斗伤害';updateClock();}
 picker.onchange=select;play.onclick=()=>{if(!playing&&clip&&time>=clip.duration){time=0;dirty=true;}playing=!playing;updateClock();};seek.oninput=()=>{if(clip){time=Number(seek.value)/1000*clip.duration;playing=false;dirty=true;updateClock();}};
 function step(dt){if(!clip)return;if(playing){time+=dt*Number(speed.value);if(time>=clip.duration){if(loop.checked)time%=clip.duration;else{time=clip.duration;playing=false;}}dirty=true;}accum+=dt;if(!dirty||accum<1/30&&playing)return;accum=0;dirty=false;
  const {worlds,visibility,kind}=poseAt(clip,time);state.dataset.phase=kind;for(const l of links)parts[l.part].animationVisible=visibility[meshes[l.mesh].node];
  for(const m of meshes)skinMesh(m,worlds);for(const l of links){const p=parts[l.part];gl.bindBuffer(gl.ARRAY_BUFFER,p.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,expandSkin(meshes[l.mesh],l.indices,l.output));}updateClock();if(clip.motion)clock.textContent+=' · '+labels[kind];
 }
 picker.value=data.clips.some(c=>c.kind==='Normal_Idle')?'Normal_Idle':data.clips[0].kind;select();step(0);
 console.log('BATS_ANIMATION_LOADED '+JSON.stringify({id:key,clips:data.clips.map(c=>c.kind),nodes:data.nodes.length}));
 return {step,get active(){return !!clip;},get kind(){return clip?.kind||'static';}};
}
