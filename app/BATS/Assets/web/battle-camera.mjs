// 普通 1-1 源 Camera 的世界旋转与 10° FOV；跟随/取景为本地实现。
export const CAMERA_BASIS = Object.freeze({right:[.612907026,0,.790155086],up:[-.437265083,.832921275,.339177581],forward:[-.658136997,-.553391529,.510503293],fov:10});
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export class BattleCamera {
 constructor(){this.center=[0,.7,9];this.distance=65;this.tan=Math.tan(CAMERA_BASIS.fov*Math.PI/360);}
 fit(units,aspect,dt){
  if(!units.length)return;
  const center=[(Math.min(...units.map(u=>u.x))+Math.max(...units.map(u=>u.x)))/2,.7,(Math.min(...units.map(u=>u.z))+Math.max(...units.map(u=>u.z)))/2];
  let half=3.5;
  for(const u of units)for(const y of [0,2]){const v=[u.x-center[0],y-center[1],u.z-center[2]];half=Math.max(half,Math.abs(dot(v,CAMERA_BASIS.right))/aspect+1.2,Math.abs(dot(v,CAMERA_BASIS.up))+1.4);}
  const distance=Math.max(45,half/this.tan+7),blend=dt===0?1:Math.min(1,dt*4);
  this.center=this.center.map((v,i)=>v+(center[i]-v)*blend);this.distance+=(distance-this.distance)*blend;
 }
 project(x,z,y,w,h){const v=[x-this.center[0],y-this.center[1],z-this.center[2]],depth=this.distance+dot(v,CAMERA_BASIS.forward);return {x:(.5+dot(v,CAMERA_BASIS.right)/(depth*this.tan*w/h)/2)*w,y:(.5-dot(v,CAMERA_BASIS.up)/(depth*this.tan)/2)*h,depth};}
 ground(px,py,w,h){
  const {right:r,up:u,forward:f}=CAMERA_BASIS;
  const eye=this.center.map((v,i)=>v-f[i]*this.distance),sx=(px/w*2-1)*this.tan*w/h,sy=(1-py/h*2)*this.tan;
  const ray=f.map((v,i)=>v+r[i]*sx+u[i]*sy);if(Math.abs(ray[1])<1e-7)return null;
  const t=-eye[1]/ray[1];return t>0?{x:eye[0]+ray[0]*t,z:eye[2]+ray[2]*t}:null;
 }
}
