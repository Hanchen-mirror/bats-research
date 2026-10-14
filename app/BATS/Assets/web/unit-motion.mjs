// Reusable per-unit timeline; no DOM, WebGL, damage or original Unity scripts.
import {sampleLocalPoses,composeWorlds,sampleVisibility,normalizeQuaternion} from './model-animation.mjs';
export function blendQuaternion(a,b,t){
 a=normalizeQuaternion(a);b=normalizeQuaternion(b);let dot=a.reduce((s,v,i)=>s+v*b[i],0);
 if(dot<0){b=b.map(v=>-v);dot=-dot;}dot=Math.min(1,dot);
 if(dot>.9995)return normalizeQuaternion(a.map((v,i)=>v+(b[i]-v)*t));
 const theta=Math.acos(dot),den=Math.sin(theta),x=Math.sin((1-t)*theta)/den,y=Math.sin(t*theta)/den;
 return a.map((v,i)=>v*x+b[i]*y);
}
export function blendPoses(a,b,t){
 if(a.length!==b.length)throw Error('动作骨骼数量不一致');
 return a.map((p,i)=>({position:p.position.map((v,j)=>v+(b[i].position[j]-v)*t),rotation:blendQuaternion(p.rotation,b[i].rotation,t),scale:p.scale.map((v,j)=>v+(b[i].scale[j]-v)*t)}));
}
export function createMotionSequence(data,steps,blend=.12){
 if(!Number.isFinite(blend)||blend<0)throw Error('动作混合时长无效');
 let cursor=0;const timeline=steps.map(s=>{
  const clip=data.clips.find(c=>c.kind===s.kind);if(!clip)throw Error('缺少动作：'+s.kind);
  const duration=s.duration??clip.duration;if(!Number.isFinite(duration)||duration<=0)throw Error('动作时长无效');
  const item={clip,start:cursor,end:cursor+duration,duration,loop:!!s.loop};cursor+=duration;return item;
 });if(!timeline.length)throw Error('动作序列为空');
 const clipTime=(s,time)=>s.loop?time%s.clip.duration:Math.min(time,s.clip.duration);
 return {duration:cursor,timeline,sample(time){
  if(!Number.isFinite(time))throw Error('动作时间无效');time=Math.max(0,Math.min(time,cursor));
  let i=timeline.findIndex(s=>time<s.end);if(i<0)i=timeline.length-1;
  const s=timeline[i],elapsed=time-s.start,t=clipTime(s,elapsed);let poses=sampleLocalPoses(data,s.clip,t);
  const fade=Math.min(blend,s.duration);
  if(i>0&&elapsed<fade&&fade>0){const previous=timeline[i-1],from=sampleLocalPoses(data,previous.clip,clipTime(previous,previous.duration));poses=blendPoses(from,poses,elapsed/fade);}
  return {kind:s.clip.kind,clipTime:t,worlds:composeWorlds(data,poses,true),visibility:sampleVisibility(data,s.clip,t)};
 }};
}
export function combatPreviewSequence(data){
 return createMotionSequence(data,[{kind:'Normal_Idle',duration:.8,loop:true},{kind:'Move_Ing',duration:1.2,loop:true},{kind:'Normal_Attack_Start'},{kind:'Normal_Attack_Ing'},{kind:'Normal_Attack_End'},{kind:'Normal_Idle',duration:.8,loop:true}]);
}
