// Preview classification only. Exported source geometry remains unchanged.
export function modelPartKind(part,key){
 const group=(part.group||part.mesh).trim().toLowerCase(),mesh=part.mesh.trim().toLowerCase().replace(/^ol_/,''),id=key.toLowerCase();
 if(/weapon|shield/.test(group))return 'equipment';
 if(group===id||mesh===id||group===id+'_mesh'||/body|eye|mouth|face|hair|head|skirt|ribbon|ear|cap|accessor|dress|coat|cloth/.test(group)||/body/.test(mesh))return 'student';
 if(/(?:^|_)wings?(?:_|[0-9]|$)/.test(group))return 'student';
 if(/halo/.test(group))return 'halo';
 return 'prop';
}

// Fit the whole clip envelope through the same perspective projection as the
// vertex shader. A world-space width/height fit alone crops deep seated poses.
export function animationFit(lo,hi,yaw,pitch,aspect){
 const height=hi[1]-lo[1],center=lo.map((v,i)=>(v+hi[i])/2);let extent=0;
 if(!Number.isFinite(height)||height<1e-6)throw Error('动作取景范围不合理');
 for(let mask=0;mask<8;mask++){
  let [x,y,z]=lo.map((v,i)=>(((mask>>i)&1?hi[i]:v)-center[i])/height);
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);[x,z]=[cy*x+sy*z,-sy*x+cy*z];[y,z]=[cp*y-sp*z,sp*y+cp*z];const distance=Math.max(.05,2.4-z);
  extent=Math.max(extent,Math.abs(x*3.5/aspect/distance),Math.abs(y*3.5/distance));
 }
 return Math.min(1,.85/Math.max(extent,1e-6));
}
