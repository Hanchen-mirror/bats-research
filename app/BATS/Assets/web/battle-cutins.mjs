import {sampleLocalPoses,composeWorlds,scalar,eulerQuaternion} from './model-animation.mjs';

// Cinematic seconds are independent of the slowed, fixed-step combat clock.
// Only property curves authored on active clips are overlaid; an override
// track must not reset unrelated bones to the prefab rest pose.
export function timelinePose(skeleton,tracks,clips,time){
 const poses=sampleLocalPoses(skeleton,null,0),active=skeleton.nodes.map(n=>n.active),enabled=skeleton.nodes.map(()=>true);let fov=null,roll=null;
 for(const track of tracks){
  const clip=clips[track.clip];if(!clip)throw Error('演出动作引用缺失');
  const peers=tracks.filter(t=>t.parentTrack===track.parentTrack);
  const playing=time>=track.start&&time<track.start+track.duration;
  const held=!playing&&!peers.some(t=>time>=t.start&&time<t.start+t.duration)&&
   (time<Math.min(...peers.map(t=>t.start))?track===peers[0]:track===peers.filter(t=>t.start+ t.duration<=time).sort((a,b)=>b.start-a.start)[0]);
  if(!playing&&!held)continue;
  const local=Math.max(0,Math.min(clip.duration,track.clipIn+Math.max(0,Math.min(time-track.start,track.duration))*track.speed));
  for(const c of clip.tracks){
   if(!poses[c.node])throw Error('演出骨骼索引越界');const v=c.curves.map(k=>scalar(k,local));
   if(['position','rotation','scale'].includes(c.property))poses[c.node][c.property]=v;
   else if(c.property==='euler')poses[c.node].rotation=eulerQuaternion(v);
   else if(c.property==='active')active[c.node]=v[0]>=.5;
   else if(c.property==='enabled')enabled[c.node]=v[0]>=.5;
   else if(c.property==='camera'&&c.attribute===3138646591)fov=v[0];
   else if(c.property==='lookRoll')roll=v[0];
  }
 }
 return {poses,active,enabled,fov,roll};
}
export function cutinFrame(data,actor,time){
 const body=timelinePose(actor,data.actorTracks,data.clips,time);
 for(const a of data.activations)body.active[a.node]=time>=a.start&&time<a.start+a.duration;
 for(let i=0;i<body.active.length;i++)if(actor.nodes[i].parent>=0)body.active[i]=body.active[i]&&body.active[actor.nodes[i].parent];
 const camera=timelinePose(data.camera,data.camera.tracks,data.clips,time),worlds=composeWorlds(data.camera,camera.poses),source=data.camera.objects[0],m=worlds[source.node];
 const axis=c=>{const v=[m[c],m[c+4],m[c+8]],n=Math.hypot(...v);return v.map(x=>x/n);};
 const fov=camera.fov??source.tree['field of view'];if(!Number.isFinite(fov)||fov<=0||fov>=170)throw Error('演出镜头视角无效');
 const eye=[m[3],m[7],m[11]];let right=axis(0),up=axis(1),forward=axis(2);
 const constraint=data.camera.constraints?.find(c=>c.node===source.node&&c.active);
 if(constraint){
  if(constraint.weight!==1||Object.values(constraint.rotationOffset).some(v=>v!==0))throw Error('尚未支持的演出镜头约束权重或偏移');
  const target=worlds[constraint.target],normalize=v=>{const n=Math.hypot(...v);if(n<1e-8)throw Error('镜头约束目标与相机重合');return v.map(x=>x/n);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  forward=normalize([target[3]-eye[0],target[7]-eye[1],target[11]-eye[2]]);right=normalize(cross([0,1,0],forward));up=normalize(cross(forward,right));
  const roll=(camera.roll??constraint.roll)*Math.PI/180,c=Math.cos(roll),s=Math.sin(roll),oldRight=right;right=right.map((v,i)=>v*c+up[i]*s);up=up.map((v,i)=>v*c-oldRight[i]*s);
 }
 const mouthEvents=data.actorTracks.flatMap(t=>(data.clips[t.clip].events||[]).filter(e=>e.functionName==='SetMouthTile').map(e=>({at:t.start+(e.time-t.clipIn)/t.speed,tile:e.intParameter}))).filter(e=>e.at<=time).sort((a,b)=>a.at-b.at);
 return {mouthTile:mouthEvents.at(-1)?.tile,worlds:composeWorlds(actor,body.poses,true),visibility:body.active.map((v,i)=>v&&body.enabled[i]),camera:{eye,right,up,forward,fov,near:Math.max(.005,source.tree['near clip plane']||.01),far:source.tree['far clip plane']||1000}};
}

export function mouthTileST(part,tile){if(!Number.isInteger(tile)||!part.mouthST)return part.mouthST;const x=tile%100,y=Math.floor(tile/100),sx=part.mouthST[0],sy=part.mouthST[1],u=sx*.25*x,v=1-sy*.25*y;if(u<0||u+sx*.25>1.00001||v<0||v+sy*.25>1.00001)throw Error('源嘴型图块越界');return [sx,sy,u,v];}

export const PRESENTATION_RULES=Object.freeze({aimScale:.1,cutinScale:.08,cutinClock:'unscaled',provenance:'Local presentation values. Original BA multipliers have not been confirmed.'});
