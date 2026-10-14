// Original grid coordinates, local A* and clearance policy. No original AI code.
class Heap {
 constructor(){this.items=[];}
 push(value){const a=this.items;let i=a.length;a.push(value);while(i){const p=(i-1)>>1;if(a[p].f<=value.f)break;a[i]=a[p];i=p;}a[i]=value;}
 pop(){const a=this.items,top=a[0],end=a.pop();if(a.length){let i=0;while(2*i+1<a.length){let j=2*i+1;if(j+1<a.length&&a[j+1].f<a[j].f)j++;if(a[j].f>=end.f)break;a[i]=a[j];i=j;}a[i]=end;}return top;}
 get length(){return this.items.length;}
}
export class NavigationGrid {
 constructor(data){
  if(data?.schemaVersion!==1||data.encounterId!==101110101||!Number.isInteger(data.width)||!Number.isInteger(data.height)||data.width<2||data.height<2||data.width*data.height>100000||!Number.isFinite(data.cellSize)||data.cellSize<=0||data.origin.length!==2||!data.origin.every(Number.isFinite))throw Error('导航版本或尺寸无效');
  this.data=data;this.width=data.width;this.height=data.height;this.cell=data.cellSize;this.origin=data.origin;
  this.source=Uint8Array.from(atob(data.mask),v=>v.charCodeAt(0));if(this.source.length!==this.width*this.height||this.source.some(v=>v>1))throw Error('导航图层长度或标记无效');
  // One orthogonal cell of clearance (prototype radius), independent of source costs.
  this.mask=this.source.map((v,i)=>v&&[i-1,i+1,i-this.width,i+this.width].every(j=>j>=0&&j<this.source.length&&this.source[j])&&i%this.width>0&&i%this.width<this.width-1?1:0);
 }
 point(i){return {x:this.origin[0]+i%this.width*this.cell,z:this.origin[1]+Math.floor(i/this.width)*this.cell};}
 index(x,z){const col=Math.round((x-this.origin[0])/this.cell),row=Math.round((z-this.origin[1])/this.cell);return col<0||col>=this.width||row<0||row>=this.height?-1:row*this.width+col;}
 valid(i){return i>=0&&i<this.mask.length&&this.mask[i]===1;}
 nearest(x,z,maxDistance=2){
  if(!Number.isFinite(x+z)||!Number.isFinite(maxDistance)||maxDistance<0)throw Error('移动位置无效');
  const i=this.index(x,z);if(this.valid(i))return {i,...this.point(i)};
  const col=Math.round((x-this.origin[0])/this.cell),row=Math.round((z-this.origin[1])/this.cell),r=Math.ceil(maxDistance/this.cell);let best=null,dist=Infinity;
  for(let y=Math.max(0,row-r);y<=Math.min(this.height-1,row+r);y++)for(let c=Math.max(0,col-r);c<=Math.min(this.width-1,col+r);c++){
   const j=y*this.width+c;if(!this.valid(j))continue;const p=this.point(j),d=Math.hypot(p.x-x,p.z-z);if(d<=maxDistance&&d<dist){best={i:j,...p};dist=d;}
  }return best;
 }
 line(a,b){
  const n=Math.max(1,Math.ceil(Math.hypot(a.x-b.x,a.z-b.z)/this.cell*3));let last=this.index(a.x,a.z);if(!this.valid(last))return false;
  for(let k=1;k<=n;k++){const i=this.index(a.x+(b.x-a.x)*k/n,a.z+(b.z-a.z)*k/n);if(!this.valid(i))return false;
   if(i%this.width!==last%this.width&&Math.floor(i/this.width)!==Math.floor(last/this.width)&&(!this.valid(Math.floor(i/this.width)*this.width+last%this.width)||!this.valid(Math.floor(last/this.width)*this.width+i%this.width)))return false;last=i;
  }return true;
 }
 path(from,to){
  const start=this.nearest(from.x,from.z,.5),end=this.nearest(to.x,to.z,.5);if(!start||!end)return null;if(start.i===end.i)return [this.point(end.i)];
  const count=this.mask.length,g=new Float64Array(count).fill(Infinity),parent=new Int32Array(count).fill(-1),closed=new Uint8Array(count),heap=new Heap();
  const heuristic=i=>Math.hypot(i%this.width-end.i%this.width,Math.floor(i/this.width)-Math.floor(end.i/this.width));g[start.i]=0;heap.push({i:start.i,f:heuristic(start.i)});
  while(heap.length){const {i}=heap.pop();if(closed[i])continue;closed[i]=1;if(i===end.i){const ids=[];let k=i;while(k!==start.i){ids.push(k);k=parent[k];if(k<0)throw Error('导航父节点损坏');}ids.reverse();return ids.map(n=>this.point(n));}
   const x=i%this.width,y=Math.floor(i/this.width);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||x+dx<0||x+dx>=this.width||y+dy<0||y+dy>=this.height)continue;const j=i+dy*this.width+dx;
    if(!this.valid(j)||closed[j]||dx&&dy&&(!this.valid(i+dx)||!this.valid(i+dy*this.width)))continue;
    const next=g[i]+(dx&&dy?Math.SQRT2:1);if(next<g[j]){g[j]=next;parent[j]=i;heap.push({i:j,f:next+heuristic(j)});}
   }
  }return null;
 }
}
