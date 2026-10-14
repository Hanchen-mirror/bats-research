// Only exact catalog IDs are accepted: a similarly named costume is not a dependency.
export function resolveComposition(recipe,entries,primaryId){
  if(!recipe)return null;
  if(!Array.isArray(recipe.layers)||!recipe.layers.length||recipe.layers.length>16)throw Error('组合图层数量无效');
  const seen=new Set();
  const layers=recipe.layers.map(layer=>{
    const entry=entries.find(e=>e.id===layer.id);
    if(!entry||seen.has(layer.id))throw Error('资源包缺少组合图层，或图层重复：'+layer.id);
    seen.add(layer.id);
    if(!['x','y','scaleX','scaleY','queue'].every(k=>Number.isFinite(layer[k]))||layer.scaleX<=0||layer.scaleY<=0)throw Error('组合坐标无效');
    if(layer.transformChain){
      if(!Array.isArray(layer.transformChain)||!layer.transformChain.length||layer.transformChain.length>64||!Number.isFinite(layer.skeletonScale)||layer.skeletonScale<=0)throw Error('组合父链无效');
      for(const node of layer.transformChain){
        if(!['x','y','scaleX','scaleY'].every(k=>Number.isFinite(node[k]))||typeof node.active!=='boolean')throw Error('父链坐标无效');
        for(const [property,curve] of Object.entries(node.curves||{})){
          if(!['active','positionX','positionY','positionZ','scaleX','scaleY','scaleZ'].includes(property)||!Array.isArray(curve)||!curve.length||curve.length>10000)throw Error('不支持的场景曲线');
          let previous=-1;
          for(const key of curve){
            if(!Number.isFinite(key.time)||key.time<0||key.time<=previous||!Array.isArray(key.coeff)||key.coeff.length!==4||!key.coeff.every(Number.isFinite))throw Error('场景曲线关键帧无效');
            previous=key.time;
          }
        }
      }
    }
    const names=new Set(entry.animations.map(a=>a.name));
    if(layer.skin&&!entry.skins?.includes(layer.skin))throw Error('缺少组合皮肤：'+layer.skin);
    if(!names.has(layer.idle))throw Error('缺少待机动作：'+layer.idle);
    let end=-1;
    for(const clip of layer.timeline||[]){
      if(!Number.isFinite(clip.start)||clip.start<0||clip.start<end-.001||!Number.isFinite(clip.duration)||clip.duration<=0||!names.has(clip.animation)||typeof clip.loop!=='boolean')throw Error('组合时间线无效');
      end=clip.start+clip.duration;
    }
    return {...layer,entry};
  }).sort((a,b)=>a.queue-b.queue);
  const v=recipe.viewport;
  if(!seen.has(primaryId)||!v||![v.x,v.y,v.height].every(Number.isFinite)||v.height<=0)throw Error('组合主图层或视口无效');
  return {...recipe,layers};
}

// Coefficients are cubic, quadratic, linear, constant in local seconds.
// Past the final key Unity holds its value; extrapolating would grow without bound.
export function sampleCurve(keys,time,step=false){
  let index=0;
  while(index+1<keys.length&&keys[index+1].time<=time)index++;
  const key=keys[index],c=key.coeff;
  if(step||index===keys.length-1||time<=key.time)return c[3];
  const t=time-key.time;
  return ((c[0]*t+c[1])*t+c[2])*t+c[3];
}

export function layerPose(recipe,time){
  if(!recipe.transformChain)return {x:recipe.x??0,y:recipe.y??0,scaleX:recipe.scaleX??1,scaleY:recipe.scaleY??1,visible:true};
  let x=0,y=0,scaleX=1,scaleY=1,visible=true;
  for(const node of recipe.transformChain){
    const value=(key,fallback)=>node.curves?.[key]?sampleCurve(node.curves[key],time,key==='active'):fallback;
    const sx=value('scaleX',node.scaleX),sy=value('scaleY',node.scaleY);
    x=value('positionX',node.x)+x*sx;y=value('positionY',node.y)+y*sy;
    scaleX*=sx;scaleY*=sy;visible=visible&&value('active',node.active?1:0)>.5;
  }
  return {x,y,scaleX:scaleX*recipe.skeletonScale*(recipe.flipX?-1:1),scaleY:scaleY*recipe.skeletonScale*(recipe.flipY?-1:1),visible};
}

// Consume every crossed boundary, including when a slow frame crosses two clips.
export function advanceTimeline(model,from,to){
  const first=model.recipe.timeline?.[0];
  // The first animation's initial pose is held until its recorded start time.
  if(first&&to<first.start)return;
  let cursor=Math.max(from,first?.start??from);
  for(const clip of model.recipe.timeline||[]){
    if(clip.start>from&&clip.start<=to){
      model.state.update(clip.start-cursor);
      model.state.setAnimation(0,clip.animation,clip.loop);
      cursor=clip.start;
    }
  }
  model.state.update(to-cursor);
}

export function projection(bounds,viewport,width,height,zoom,panX,panY){
  const scale=viewport?viewport.height/height/zoom:Math.max(bounds.width/width,bounds.height/height)*1.12/zoom;
  const w=width*scale,h=height*scale;
  return {x:(viewport?.x??(bounds.x+bounds.width/2))-w/2+panX,
          y:(viewport?.y??(bounds.y+bounds.height/2))-h/2+panY,width:w,height:h,scale};
}
