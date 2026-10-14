import {decodeSkin,composeWorlds,skinMesh,expandSkin,trs,eulerQuaternion} from './model-animation.mjs';
import {timelinePose} from './battle-cutins.mjs';
const transform=(m,p)=>[m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11]];
const rgba=c=>['r','g','b','a'].map(k=>c?.[k]??1);
function curve(c,t){const keys=c?.m_Curve||[];if(!keys.length)return 0;let a=keys[0],b=a;for(const k of keys){if(k.time<=t)a=k;if(k.time>=t){b=k;break;}b=k;}if(t<=a.time||a===b||!Number.isFinite(Number(a.outSlope))||!Number.isFinite(Number(b.inSlope)))return Number(a.value);const d=b.time-a.time,u=Math.max(0,Math.min(1,(t-a.time)/d));return (2*u**3-3*u*u+1)*a.value+(u**3-2*u*u+u)*d*a.outSlope+(-2*u**3+3*u*u)*b.value+(u**3-u*u)*d*b.inSlope;}
export function minmax(c,t=0,random=.5){if(!c)return 0;switch(c.minMaxState){case 1:return curve(c.maxCurve,t)*c.scalar;case 2:return (curve(c.minCurve,t)*(1-random)+curve(c.maxCurve,t)*random)*c.scalar;case 3:return c.minScalar+(c.scalar-c.minScalar)*random;default:return c.scalar;}}
function gradient(g,t){if(!g)return [1,1,1,1];const sample=(prefix,count,channel)=>{const n=g[count]||0;if(!n)return 1;let i=0;while(i<n-1&&g[prefix+(i+1)]/65535<=t)i++;const j=Math.min(n-1,i+1),a=g[prefix+i]/65535,b=g[prefix+j]/65535,u=a===b?0:Math.max(0,Math.min(1,(t-a)/(b-a)));return g['key'+i][channel]*(1-u)+g['key'+j][channel]*u;};return ['r','g','b'].map(k=>sample('ctime','m_NumColorKeys',k)).concat(sample('atime','m_NumAlphaKeys','a'));}
function color(c,t,r){if(!c)return [1,1,1,1];if(c.minMaxState===1)return gradient(c.maxGradient,t);if(c.minMaxState===2){const a=rgba(c.minColor),b=rgba(c.maxColor);return a.map((v,i)=>v*(1-r)+b[i]*r);}if(c.minMaxState===3){const a=gradient(c.minGradient,t),b=gradient(c.maxGradient,t);return a.map((v,i)=>v*(1-r)+b[i]*r);}return rgba(c.maxColor);}
function random(seed){let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
// Supported source modules are deliberately explicit. Custom shader channels,
// trails, noise, subemitters and original attachment scripts remain pending.
export class BattleEffects {
 constructor(renderer,index){this.renderer=renderer;this.index=index;this.assets=new Map();this.metrics={assets:0,drawnParticles:0,drawnMeshes:0,unsupported:[]};this.buffer=renderer.gl.createBuffer();}
 async load(prefab){if(!prefab)return null;const base=this.index.assets[prefab.cab+':'+prefab.pathId];if(!base)return null;if(this.assets.has(base))return this.assets.get(base);const pending=this.read(base);this.assets.set(base,pending);const a=await pending;this.assets.set(base,a);return a;}
 async read(base){const get=async file=>{const r=await fetch('/app/'+base+file);if(!r.ok)throw Error('技能特效缺失：'+file);return r;},data=await(await get('fx.json')).json(),r=this.renderer,gl=r.gl;
  const parts=[];for(const p of data.parts){const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,await(await get(p.buffer)).arrayBuffer(),gl.DYNAMIC_DRAW);parts.push({...p,buffer,texture:await r.texture(base,p.texture)});}
  const meshes=[];for(const mesh of data.meshes)meshes.push(decodeSkin(mesh,await(await get(mesh.buffer)).arrayBuffer()));
  const links=[];for(const l of data.links){const indices=new Uint32Array(await(await get(l.indices)).arrayBuffer());links.push({...l,indices,output:new Float32Array(indices.length*5)});}
  for(const p of data.particles){for(const m of p.materials)m.textureHandle=await r.texture(base,m.texture);if(p.geometry)p.values=new Float32Array(await(await get(p.geometry.buffer)).arrayBuffer());for(const name of ['NoiseModule','SubModule','TrailModule','CollisionModule'])if(p.tree[name]?.enabled)this.metrics.unsupported.push(data.name+'/'+p.name+'/'+name);}
  this.metrics.assets++;return {data,parts,meshes,links};
 }
 async preload(cutins){for(const data of Object.values(cutins.models))for(const control of data.controls)await this.load(control.prefab);for(const cues of Object.values(this.index.battle))for(const cue of cues)await this.load(cue.prefab);}
 drawControls(controls,time,placement,camera){for(const c of controls){if(!c.prefab||time<c.start||time>=c.start+c.duration)continue;const base=this.index.assets[c.prefab.cab+':'+c.prefab.pathId],asset=this.assets.get(base);if(asset&&!asset.then)this.draw(asset,(time-c.start)*(c.speed||1)+(c.clipIn||0),placement,camera,c.seed||893);}}
 draw(asset,time,placement,camera,seed){const {data}=asset,r=this.renderer,gl=r.gl;
  const timeline=timelinePose(data,data.tracks,data.clips,time),worlds=composeWorlds(data,timeline.poses);const scale=placement.scale||1,yaw=placement.yaw||0,pos=placement.position||[0,0,0];
  gl.uniform3fv(r.u.position,pos);gl.uniform3fv(r.u.anchor,[0,0,0]);gl.uniform1f(r.u.scale,scale);gl.uniform1f(r.u.yaw,yaw);gl.uniform4fv(r.u.tint,[1,1,1,1]);
  for(const mesh of asset.meshes)skinMesh(mesh,worlds);
  for(const link of asset.links){const mesh=asset.meshes[link.mesh],part=asset.parts[link.part];if(!timeline.active[mesh.node]&&mesh.node!==0)continue;gl.bindBuffer(gl.ARRAY_BUFFER,part.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,expandSkin(mesh,link.indices,link.output));r.bind(part);gl.depthMask(part.alphaMode!=='blend');gl.drawArrays(gl.TRIANGLES,0,part.vertices);this.metrics.drawnMeshes++;}
  gl.depthMask(false);
  for(const [index,emitter] of data.particles.entries()){
   const tree=emitter.tree,initial=tree.InitialModule;if(!initial.enabled||!emitter.materials.length||!tree.playOnAwake)continue;let active=timeline.active[emitter.node];for(let i=emitter.node;i>0;i=data.nodes[i].parent)if(!timeline.active[i])active=false;if(!active)continue;
   const rng=random(seed+index*997),delay=minmax(tree.startDelay),length=tree.lengthInSec||1,clock=time*tree.simulationSpeed-delay;if(clock<0)continue;
   const emission=tree.EmissionModule;if(!emission.enabled)continue;const births=[],cycles=tree.looping?Math.floor(clock/length)+1:1,rate=Math.max(0,minmax(emission.rateOverTime,(clock%length)/length));
   if(rate>0){const life=Math.max(.05,initial.startLifetime.scalar||1),first=Math.max(0,Math.floor((clock-life)/ (1/rate)));for(let i=first;i<=clock*rate&&births.length<256;i++){const born=i/rate;if(tree.looping||born<length)births.push(born);}}
   for(let cycle=Math.max(0,cycles-3);cycle<cycles;cycle++)for(const burst of emission.m_Bursts||[]){const count=Math.min(256,Math.round(minmax(burst.countCurve,0,rng()))),repeat=Math.max(1,burst.cycleCount||1);for(let j=0;j<repeat;j++){const born=cycle*length+burst.time+j*(burst.repeatInterval||0);if(born>clock)continue;for(let i=0;i<count&&births.length<256;i++)births.push(born);}}
   const world=worlds[emitter.node],values=[];
   for(const born of births){const q=rng(),life=Math.max(.001,minmax(initial.startLifetime,0,q)),age=clock-born;if(age<0||age>life)continue;const normalized=age/life,shape=tree.ShapeModule,theta=rng()*Math.PI*2,rad=Math.sqrt(rng())*(shape.radius?.value??shape.radius??0),point=shape.enabled?[Math.cos(theta)*rad,0,Math.sin(theta)*rad]:[0,0,0];
    if(shape.enabled&&shape.type===5){point[0]=(rng()-.5)*(shape.m_Scale?.x||1);point[1]=(rng()-.5)*(shape.m_Scale?.y||1);point[2]=(rng()-.5)*(shape.m_Scale?.z||1);}
    const speed=minmax(initial.startSpeed,0,q);point[1]+=speed*age-4.905*minmax(initial.gravityModifier,normalized,q)*age*age;const velocity=tree.VelocityModule;if(velocity?.enabled){point[0]+=minmax(velocity.x,normalized,q)*age;point[1]+=minmax(velocity.y,normalized,q)*age;point[2]+=minmax(velocity.z,normalized,q)*age;}
    const center=transform(world,point),size=minmax(initial.startSize,0,q)*(tree.SizeModule?.enabled?minmax(tree.SizeModule.curve,normalized,q):1),stretch=Math.hypot(world[0],world[4],world[8]),sx=size*stretch,sy=(initial.size3D?minmax(initial.startSizeY,0,q):size)*Math.hypot(world[1],world[5],world[9]);if(!Number.isFinite(sx+sy+center[0]+center[1]+center[2])||sx===0||sy===0)continue;
    const angle=minmax(initial.startRotation,0,q)+(tree.RotationModule?.enabled?minmax(tree.RotationModule.z,normalized,q)*age:0),ca=Math.cos(angle),sa=Math.sin(angle),right=camera.right,up=emitter.renderMode===2?[0,0,1]:camera.up;
    const c=color(initial.startColor,0,q),over=tree.ColorModule?.enabled?color(tree.ColorModule.gradient,normalized,q):[1,1,1,1],rgba=c.map((v,i)=>Math.max(0,Math.min(i===3?1:16,Number(v)*Number(over[i]))));const append=(p,u,v)=>values.push(...p,u,v,...rgba);
    if(emitter.values){const rotation=trs([0,0,0],eulerQuaternion([0,angle*180/Math.PI,0]),[size,size,size]);for(let i=0;i<emitter.values.length;i+=5){const p=transform(world,transform(rotation,[emitter.values[i],emitter.values[i+1],emitter.values[i+2]]));append(p.map((v,a)=>v+center[a]-world[a*4+3]),emitter.values[i+3],emitter.values[i+4]);}}
    else for(const [u,v] of [[0,0],[1,0],[0,1],[0,1],[1,0],[1,1]]){const x=((u-.5)*sx)*ca-((v-.5)*sy)*sa,y=((u-.5)*sx)*sa+((v-.5)*sy)*ca;append(center.map((n,a)=>n+right[a]*x+up[a]*y),u,v);}
    this.metrics.drawnParticles++;
   }
   if(!values.length)continue;const m=emitter.materials[0];
   gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);r.bind({buffer:this.buffer,texture:m.textureHandle,textureST:m.textureST,alphaMode:'blend'});gl.enableVertexAttribArray(r.color);gl.vertexAttribPointer(r.color,4,gl.FLOAT,false,36,20);gl.vertexAttribPointer(r.position,3,gl.FLOAT,false,36,0);gl.vertexAttribPointer(r.uv,2,gl.FLOAT,false,36,12);gl.uniform4fv(r.u.tint,m.tint.map(v=>Math.min(16,v)));gl.blendFunc(gl.SRC_ALPHA,m.dstBlend===1?gl.ONE:gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,values.length/9);
  }
  gl.disableVertexAttribArray(r.color);gl.vertexAttrib4f(r.color,1,1,1,1);gl.depthMask(true);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.uniform4fv(r.u.tint,[1,1,1,1]);
 }
 dispose(){const gl=this.renderer.gl;gl.deleteBuffer(this.buffer);for(const a of this.assets.values())if(!a.then)for(const p of a.parts)gl.deleteBuffer(p.buffer);}
}
