// Source curve sampling and row-major Unity skin matrices, independent of WebGL.
export function scalar(keys,time){
 if(!keys.length)throw Error('动作曲线没有关键帧');
 let lo=0,hi=keys.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(keys[mid][0]<=time)lo=mid;else hi=mid-1;}
 const k=keys[lo],t=Math.max(0,time-k[0]);return ((k[1]*t+k[2])*t+k[3])*t+k[4];
}
export function normalizeQuaternion(q){const n=Math.hypot(...q);if(!Number.isFinite(n)||n<1e-8)throw Error('无效的骨骼旋转');return q.map(v=>v/n);}
export function quaternionProduct(a,b){const [x,y,z,w]=a,[X,Y,Z,W]=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];}
// Unity Quaternion.Euler applies Z, X, Y in that order (Unity 2021.3 docs).
export function eulerQuaternion(degrees){const [x,y,z]=degrees.map(v=>v*Math.PI/360);return quaternionProduct(quaternionProduct([0,Math.sin(y),0,Math.cos(y)],[Math.sin(x),0,0,Math.cos(x)]),[0,0,Math.sin(z),Math.cos(z)]);}
export function sampleVisibility(data,clip,time){
 const active=data.nodes.map(n=>n.active),enabled=data.nodes.map(()=>true);
 if(clip)for(const t of clip.tracks){if(t.property==='active')active[t.node]=scalar(t.curves[0],time)>=.5;else if(t.property==='enabled')enabled[t.node]=scalar(t.curves[0],time)>=.5;}
 for(let i=0;i<active.length;i++)if(data.nodes[i].parent>=0)active[i]=active[i]&&active[data.nodes[i].parent];return active.map((v,i)=>v&&enabled[i]);
}
export function trs(p,q,s){
 const [x,y,z,w]=normalizeQuaternion(q);
 return new Float64Array([(1-2*(y*y+z*z))*s[0],2*(x*y-z*w)*s[1],2*(x*z+y*w)*s[2],p[0],2*(x*y+z*w)*s[0],(1-2*(x*x+z*z))*s[1],2*(y*z-x*w)*s[2],p[1],2*(x*z-y*w)*s[0],2*(y*z+x*w)*s[1],(1-2*(x*x+y*y))*s[2],p[2],0,0,0,1]);
}
export function multiply(a,b){const c=new Float64Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let k=0;k<4;k++)c[i*4+j]+=a[i*4+k]*b[k*4+j];return c;}
export function sampleLocalPoses(data,clip,time){
 const poses=data.nodes.map(n=>({position:n.position,rotation:n.rotation,scale:n.scale}));
 if(clip)for(const track of clip.tracks){const values=track.curves.map(c=>scalar(c,time));if(track.property==='euler')poses[track.node].rotation=eulerQuaternion(values);else if(['position','rotation','scale'].includes(track.property))poses[track.node][track.property]=values;}
 return poses;
}
export function composeWorlds(data,poses,follow=false){
 const locals=poses.map(p=>trs(p.position,p.rotation,p.scale));
 const worlds=[];for(let i=0;i<data.nodes.length;i++){const n=data.nodes[i];if(n.parent>=i||n.parent< -1)throw Error('骨骼层级顺序无效');worlds.push(n.parent<0?locals[i]:multiply(worlds[n.parent],locals[i]));}
 if(follow)for(const f of data.followers||[]){
  if(f.fixYRotation!==0)throw Error('尚未支持的光环跟随旋转');
  if(!worlds[f.target]||!worlds[f.node])throw Error('光环跟随目标越界');
  // A deterministic target-relative pose, using serialized references/offsets.
  // Unity's spring smoothing and offset clamps are not inferred from names.
  worlds[f.node]=multiply(worlds[f.target],trs(f.relativePosition,f.relativeRotation,poses[f.node].scale));
  const descendants=new Set([f.node]);
  for(let i=f.node+1;i<data.nodes.length;i++)if(descendants.has(data.nodes[i].parent)){worlds[i]=multiply(worlds[data.nodes[i].parent],locals[i]);descendants.add(i);}
 }
 return worlds;
}
export function sampleWorlds(data,clip,time){
 return composeWorlds(data,sampleLocalPoses(data,clip,time),!!clip);
}
export function decodeSkin(mesh,bytes){
 if(bytes.byteLength!==mesh.vertices*44)throw Error('蒙皮顶点长度不匹配');
 const view=new DataView(bytes),position=new Float32Array(mesh.vertices*3),uv=new Float32Array(mesh.vertices*2),indices=new Uint16Array(mesh.vertices*4),weights=new Float32Array(mesh.vertices*4);
 for(let v=0;v<mesh.vertices;v++){const o=v*44;for(let a=0;a<3;a++)position[v*3+a]=view.getFloat32(o+a*4,true);for(let a=0;a<2;a++)uv[v*2+a]=view.getFloat32(o+12+a*4,true);let total=0;for(let a=0;a<4;a++){indices[v*4+a]=view.getUint16(o+20+a*2,true);const w=view.getFloat32(o+28+a*4,true);if(!Number.isFinite(w)||w<0||(w&&mesh.bones.length&&indices[v*4+a]>=mesh.bones.length))throw Error('蒙皮权重无效');weights[v*4+a]=w;total+=w;}if(Math.abs(total-1)>.005)throw Error('蒙皮权重未归一化');}
 return {...mesh,position,uv,indices,weights,posed:new Float32Array(mesh.vertices*3)};
}
export function skinMesh(mesh,worlds){
 const matrices=mesh.bones.length?mesh.bones.map((b,i)=>multiply(worlds[b],mesh.bindPoses[i])):[worlds[mesh.node]];
 const output=mesh.posed;
 for(let v=0;v<mesh.vertices;v++){
  const x=mesh.position[v*3],y=mesh.position[v*3+1],z=mesh.position[v*3+2];let px=0,py=0,pz=0;
  for(let a=0;a<4;a++){const w=mesh.weights[v*4+a];if(!w)continue;const m=matrices[mesh.bones.length?mesh.indices[v*4+a]:0];px+=(m[0]*x+m[1]*y+m[2]*z+m[3])*w;py+=(m[4]*x+m[5]*y+m[6]*z+m[7])*w;pz+=(m[8]*x+m[9]*y+m[10]*z+m[11])*w;}
  if(!Number.isFinite(px+py+pz))throw Error('动作产生了无效顶点');output[v*3]=px;output[v*3+1]=py;output[v*3+2]=pz;
 }
 return output;
}
export function expandSkin(mesh,indices,output){for(let v=0;v<indices.length;v++){const i=indices[v];if(i>=mesh.vertices)throw Error('蒙皮三角索引越界');output[v*5]=mesh.posed[i*3];output[v*5+1]=mesh.posed[i*3+1];output[v*5+2]=mesh.posed[i*3+2];output[v*5+3]=mesh.uv[i*2];output[v*5+4]=mesh.uv[i*2+1];}return output;}
