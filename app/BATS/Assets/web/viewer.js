'use strict';
import {prepareCatalog,filterGroups,pickScene,kindLabel,annotateGroups} from './catalog-model.mjs';
import {resolveComposition,advanceTimeline,projection,layerPose} from './composition-model.mjs';
import {LocalAudio,voicePath,dialogLabel,localizedAnimation} from './audio-player.mjs';
const el=id=>document.getElementById(id);
const source=new URLSearchParams(location.search).get('source')==='pack'?'pack':'demo';
localStorage.setItem('bats-source',source);
const base='/'+source+'/';
const assetUrl=p=>base+p.split('/').map(encodeURIComponent).join('/');
let entries=[],groups=[],visible=[],mode='memory_candidate',current=null,loading=0,controller=null,paused=false,talkIndex=0,onlyFavorites=false;
let activeEntry=null,contextLost=false;
let audioCatalog=null,sceneAudio=null,dialogRun=0,locale=localStorage.getItem('voice-locale')==='jp'?'jp':'cn',hostPaused=false;
const audio=new LocalAudio({url:assetUrl,notify:text=>{el('audio-status').textContent=text;console.log('HALL_AUDIO_STATUS '+text);}});
function subtitle(text){el('subtitle').textContent=text;}
function stopDialogue(){++dialogRun;audio.stopVoice();subtitle('');}
function audioPause(){audio.pause(paused||document.hidden||hostPaused||contextLost).catch(e=>console.warn(e));}
window.hallHostPause=value=>{hostPaused=value;audioPause();};
function languageLabel(){return locale==='cn'?'中配':'日配';}
function audioControls(){
 sceneAudio=audioCatalog?.scenes?.[activeEntry?.id]||null;
 el('dialogue').replaceChildren();
 for(const d of sceneAudio?.dialogs||[])option(el('dialogue'),d.id,dialogLabel(d.id));
 const preferred=sceneAudio?.dialogs.find(d=>/Idle1$/.test(d.id));if(preferred)el('dialogue').value=preferred.id;
 el('dialogue-play').disabled=!sceneAudio?.dialogs.length;
 el('voice-language').textContent='配音：'+languageLabel()+' ⇄';el('voice-language').setAttribute('aria-label','切换中配日配');
 el('bgm').value=sceneAudio?.kind==='memory'?'auto':localStorage.getItem('normal-bgm')||'1';
 if(!el('bgm').value)el('bgm').value='auto';
 el('audio-status').textContent=!audioCatalog?'未安装音频补充包':!sceneAudio?'此素材尚未关联对白':`${sceneAudio.dialogs.length} 组对白 · ${languageLabel()} · ${audio.enabled?'声音已开启':'点“开启声音”播放'}`;
 playBgm();
}
function playBgm(){
 const value=el('bgm').value,id=value==='auto'?sceneAudio?.bgmId:value;
 audio.bgm(id==='off'?null:audioCatalog?.bgms?.[id]?.paths?.[0]);
}
function spineVoice(event){
 if(event.data.name!=='Talk'||!sceneAudio||sceneAudio.kind!=='memory')return;
 const clip=sceneAudio.events[event.stringValue];
 if(clip?.text)subtitle(clip.text);
 const path=voicePath(clip,locale);
 if(path)audio.voiceClip(path);else {audio.stopVoice();el('audio-status').textContent=languageLabel()+'缺少此句音频：'+event.stringValue;}
}
async function playDialogue(dialog){
 if(!current||!dialog)return;
 stopDialogue();const run=dialogRun,scene=current;
 await audio.enable();el('sound').textContent='关闭声音';audioPause();playBgm();
 const clips=sceneAudio.kind==='normal'?dialog.clips:dialog.events.map(k=>sceneAudio.events[k]);
 await audio.preload(clips.map(c=>voicePath(c,locale)));
 if(run!==dialogRun||current!==scene)return;
 subtitle(dialog.text);el('dialogue').value=dialog.id;
 el('audio-status').textContent=languageLabel()+' · '+dialogLabel(dialog.id)+(clips.some(c=>!voicePath(c,locale))?' · 部分音频缺失':'');
 const names=current.skeleton.data.animations.map(a=>a.name),name=localizedAnimation(dialog.animation,names,locale);
 if(name){
  if(sceneAudio.kind==='memory'){
   const body=localizedAnimation(name.replace(/_M(_CN)?$/,'_A$1'),names,locale);
   playAnimation(body||current.entry.defaultAnimation, !body,true);
   current.state.setAnimation(1,name,false);current.state.addEmptyAnimation(1,.15,0);
   el('animation').value=name;
  }else playAnimation(name,true,true);
 }
 console.log('HALL_DIALOGUE '+JSON.stringify({scene:activeEntry.id,group:dialog.id,locale,animation:name}));
 if(sceneAudio.kind==='normal'){
  for(const clip of dialog.clips){if(run!==dialogRun)return;const path=voicePath(clip,locale);if(path&&!await audio.voiceClip(path))break;}
  if(run===dialogRun&&current===scene)resetToIdle();
 }
}
let recipes={},compositionEnabled=true,introTime=null;
let lastVisibleLayers='';
let zoom=1,panX=0,panY=0,worldPerPixel=1,drag=null;
let ctx,shader,batcher,renderer,matrix,viewBounds,frameTime=0;
const canvas=el('scene');
function readSaved(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
const savedFavorites=readSaved('favorites',[]);
const favorites=new Set(Array.isArray(savedFavorites)?savedFavorites:[]);
const savedMode=localStorage.getItem('mode-'+source);
if(['normal_candidate','memory_candidate','all'].includes(savedMode))mode=savedMode;
onlyFavorites=readSaved('only-favorites',false)===true;
function message(text){el('message').textContent=text;}
function signal(text){console.log('HALL '+text);el('detail').textContent=text;}
function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}
async function fetchOk(url,signal){const r=await fetch(url,{signal,cache:'no-store'});if(!r.ok)throw Error('无法读取本地文件：'+url);return r;}
function dispose(model){if(model)for(const t of model.textures)t.dispose();}
async function texture(url,signal){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    const stop=()=>{image.onload=null;image.onerror=null;image.src='';reject(new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',stop,{once:true});
    image.onload=()=>{signal.removeEventListener('abort',stop);if(signal.aborted)return stop();
      try{
        const limit=ctx.gl.getParameter(ctx.gl.MAX_TEXTURE_SIZE);
        if(image.width>limit||image.height>limit)throw Error(`贴图尺寸 ${image.width}×${image.height} 超过本机上限 ${limit}`);
        resolve(new spine.GLTexture(ctx,image));
      }catch(e){reject(e);}
    };
    image.onerror=()=>{signal.removeEventListener('abort',stop);reject(Error('贴图读取失败：'+url));};
    image.src=url;
  });
}
function redrawList(){
  visible=filterGroups(groups,mode,el('search').value,favorites,onlyFavorites);
  el('counter').textContent=`${visible.length} 个素材组 · ${visible.reduce((n,g)=>n+g.visible.length,0)} 个表现 / 共 ${entries.length} 个可解析表现 · `+(source==='demo'?'内置样本':'本地资源包');
  for(const b of document.querySelectorAll('[data-mode]'))b.classList.toggle('active',b.dataset.mode===mode);
  el('favorites-filter').classList.toggle('active',onlyFavorites);
  el('favorites-filter').setAttribute('aria-pressed',String(onlyFavorites));
  const scroll=el('list').scrollTop;
  el('list').replaceChildren();
  for(const group of visible){const b=document.createElement('button');b.dataset.group=group.key;
    b.classList.toggle('active',activeEntry?.groupKey===group.key);
    b.append((group.scenes.some(s=>favorites.has(s.id))?'★ ':'')+group.label);
    const small=document.createElement('small');
    const counts=['normal_candidate','memory_candidate','background_candidate'].map(kind=>{
      const count=group.scenes.filter(s=>s.kind===kind).length;
      const label=kind==='memory_candidate'?'记忆素材':kindLabel(kind);
      return count?`${label} ${count}`:'';
    }).filter(Boolean);
    const openingCount=group.scenes.filter(s=>recipes[s.id]).length;
    if(openingCount)counts.push('开场预览 '+openingCount);
    small.textContent=counts.join(' · ')+(group.identity?' · 表ID '+group.identity.characterId+(group.identity.status==='prefab-checked'?' · 场景引用已核对':' · 表关联候选'):group.candidate?' · 候选归属':'');b.append(small);
    b.onclick=()=>loadScene(pickScene({...group,scenes:group.visible},mode,activeEntry?.id));el('list').append(b);}
  if(!visible.length){const p=document.createElement('p');p.textContent='没有匹配的素材，试试切换类型或清空搜索。';el('list').append(p);}
  el('list').scrollTop=scroll;
}
function updatePresentations(entry){
  const group=groups.find(g=>g.key===entry.groupKey);
  el('presentation').replaceChildren();
  for(const s of group?.scenes||[entry])option(el('presentation'),s.id,kindLabel(s.kind)+' · '+s.skeleton.split('/').pop().replace(/\.skel$/,'')+(s.componentCandidate?'（部件候选）':''));
  el('presentation').value=entry.id;
}
async function loadScene(entry){
  if(contextLost)return;
  const generation=++loading;controller?.abort();controller=new AbortController();const abort=controller.signal;
  stopDialogue();audio.reset();sceneAudio=null;
  dispose(current);current=null;introTime=null;const textures=[];
  activeEntry=entry;delete document.body.dataset.loaded;
  el('composite').disabled=!recipes[entry.id];el('composite').checked=compositionEnabled&&!!recipes[entry.id];el('intro').disabled=true;
  zoom=1;panX=0;panY=0;el('zoom').value=1;
  updatePresentations(entry);redrawList();el('detail').textContent='正在读取本地动画…';
  message('正在打开 '+entry.groupLabel+'…');el('title').textContent=entry.groupLabel;
  try{
    const composition=compositionEnabled?resolveComposition(recipes[entry.id],entries,entry.id):null;
    const layers=[];
    for(const recipe of composition?.layers||[{entry}]){
    const layerEntry=recipe.entry;
    const [atlasText,binary]=await Promise.all([
      fetchOk(assetUrl(layerEntry.atlas),abort).then(r=>r.text()),
      fetchOk(assetUrl(layerEntry.skeleton),abort).then(r=>r.arrayBuffer())]);
    const atlas=new spine.TextureAtlas(atlasText);
    for(const page of atlas.pages){
      const found=layerEntry.pages.find(p=>p.atlas_name.toLowerCase()===page.name.toLowerCase());
      if(!found)throw Error('缺少图集页：'+page.name);
      const tex=await texture(assetUrl(found.path),abort);textures.push(tex);page.setTexture(tex);
    }
    const data=new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(binary));
    const skeleton=new spine.Skeleton(data);const stateData=new spine.AnimationStateData(data);stateData.defaultMix=.18;
    if(recipe.skin)skeleton.setSkinByName(recipe.skin);
    const state=new spine.AnimationState(stateData);
    if(layerEntry.id===entry.id)state.addListener({event:(_track,event)=>spineVoice(event)});
    const pose=composition?layerPose(recipe,Number.MAX_SAFE_INTEGER):{visible:true};
    if(composition){skeleton.x=pose.x;skeleton.y=pose.y;skeleton.scaleX=pose.scaleX;skeleton.scaleY=pose.scaleY;}
    if(layerEntry.defaultAnimation)state.setAnimation(0,layerEntry.defaultAnimation,true);
    state.apply(skeleton);skeleton.updateWorldTransform(spine.Physics.update);
    layers.push({entry:layerEntry,recipe,atlas,skeleton,state,visible:pose.visible,pma:atlas.pages.some(p=>p.pma)});
    }
    if(generation!==loading){for(const t of textures)t.dispose();return;}
    const primary=layers.find(l=>l.entry.id===entry.id),{skeleton,state,atlas}=primary,data=skeleton.data;
    const offset=new spine.Vector2(),size=new spine.Vector2();skeleton.getBounds(offset,size,[]);
    viewBounds={x:offset.x,y:offset.y,width:size.x,height:size.y};
    if(!Object.values(viewBounds).every(Number.isFinite)||size.x<=0||size.y<=0) viewBounds={x:data.x,y:data.y,width:data.width||1000,height:data.height||1000};
    current={...primary,textures,layers,composition};
    lastVisibleLayers='';
    el('composite').disabled=!recipes[entry.id];el('composite').checked=!!composition;
    el('intro').disabled=!composition;
    paused=false;el('play').textContent='暂停';talkIndex=0;
    audioPause();audioControls();
    el('animation').replaceChildren();for(const a of data.animations)option(el('animation'),a.name,a.name);
    el('animation').value=entry.defaultAnimation||'';
    el('skin').replaceChildren();for(const s of data.skins)option(el('skin'),s.name,s.name);
    el('skin').value=skeleton.skin?.name||'default';
    const talks=data.animations.filter(a=>/^Talk_.*_A(?:_CN)?$/.test(a.name));
    el('interact').disabled=talks.length===0&&!sceneAudio?.dialogs.length;
    el('favorite').textContent=favorites.has(entry.id)?'★ 已收藏':'☆ 收藏';
    localStorage.setItem('last-'+source,entry.id);redrawList();message('');
    signal(kindLabel(entry.kind)+' · '+data.animations.length+' 个动作'+(composition?' · '+layers.length+' 层组合预览 / 试验构图':entry.candidate?' · 归属待核对':''));
    console.log('HALL_LOADED '+JSON.stringify({id:entry.id,source,group:entry.groupKey,layers:layers.length,composition:!!composition}));document.body.dataset.loaded=entry.id;
  }catch(e){for(const t of textures)t.dispose();if(generation===loading&&e.name!=='AbortError'){message(e.message+'\n可切换其他表现，或重新导入完整资源包。');console.error(e);}}
}
function playAnimation(name,loop,keepDialogue=false){
  if(!current||!name)return;
  if(!keepDialogue)stopDialogue();
  if(introTime!==null)resetToIdle();
  current.skeleton.setToSetupPose();current.state.clearTracks();current.state.setAnimation(0,name,loop);
  if(!loop&&current.entry.defaultAnimation)current.state.addAnimation(0,current.entry.defaultAnimation,true,0);
  el('animation').value=name;paused=false;audioPause();el('play').textContent='暂停';console.log('HALL_ANIMATION '+name);
}
function resetToIdle(){
  introTime=null;
  for(const layer of current.layers){layer.state.clearTracks();layer.skeleton.setToSetupPose();if(layer.entry.defaultAnimation)layer.state.setAnimation(0,layer.entry.defaultAnimation,true);}
}
function applyLayerPose(layer,time){
  if(!current.composition)return;
  const pose=layerPose(layer.recipe,time);
  layer.visible=pose.visible;layer.skeleton.x=pose.x;layer.skeleton.y=pose.y;
  layer.skeleton.scaleX=pose.scaleX;layer.skeleton.scaleY=pose.scaleY;
}
async function playIntro(){
  if(!current?.composition)return;
  stopDialogue();const run=dialogRun,scene=current;
  if(audioCatalog){await audio.enable();el('sound').textContent='关闭声音';playBgm();await audio.preload(Object.values(sceneAudio?.events||{}).map(c=>voicePath(c,locale)));}
  if(run!==dialogRun||current!==scene)return;
  resetToIdle();introTime=0;
  for(const layer of current.layers){
    const first=layer.recipe.timeline?.[0];
    if(first){layer.state.clearTracks();layer.state.setAnimation(0,first.animation,first.loop);}
    layer.state.apply(layer.skeleton);layer.skeleton.updateWorldTransform(spine.Physics.update);
  }
  paused=false;audioPause();el('play').textContent='暂停';console.log('HALL_INTRO '+current.entry.id);
}
function interact(){
  const dialogs=sceneAudio?.dialogs.filter(d=>/Idle\d+$/.test(d.id));
  if(dialogs?.length){playDialogue(dialogs[talkIndex++%dialogs.length]);return;}
  if(!current)return;const names=current.skeleton.data.animations.map(a=>a.name);
  let talks=names.filter(n=>/^Talk_.*_A_CN$/.test(n));if(!talks.length)talks=names.filter(n=>/^Talk_.*_A$/.test(n));
  if(talks.length)playAnimation(talks[talkIndex++%talks.length],false);
}
function frame(now){
  const dt=frameTime?Math.min((now-frameTime)/1000,.05):0;frameTime=now;
  const ratio=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.floor(canvas.clientWidth*ratio)),h=Math.max(1,Math.floor(canvas.clientHeight*ratio));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const gl=ctx.gl;gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
  if(current&&!contextLost){
    if(!paused&&!document.hidden&&!hostPaused){
      for(const layer of current.layers){applyLayerPose(layer,introTime===null?Number.MAX_SAFE_INTEGER:introTime+dt);layer.skeleton.update(dt);if(introTime===null)layer.state.update(dt);else advanceTimeline(layer,introTime,introTime+dt);layer.state.apply(layer.skeleton);layer.skeleton.updateWorldTransform(spine.Physics.update);}
      if(introTime!==null){introTime+=dt;const name=current.state.getCurrent(0)?.animation.name;if(name)el('animation').value=name;}
    }
    const view=projection(viewBounds,current.composition?.viewport,w,h,zoom,panX,panY);
    worldPerPixel=view.scale*ratio;
    matrix.ortho2d(view.x,view.y,view.width,view.height);
    shader.bind();shader.setUniformi(spine.Shader.SAMPLER,0);shader.setUniform4x4f(spine.Shader.MVP_MATRIX,matrix.values);
    for(const layer of current.layers){if(!layer.visible)continue;renderer.premultipliedAlpha=layer.pma;batcher.begin(shader);renderer.draw(batcher,layer.skeleton);batcher.end();}shader.unbind();
    if(current.composition){const visible=current.layers.filter(l=>l.visible).map(l=>l.entry.id);const key=JSON.stringify(visible);if(key!==lastVisibleLayers){console.log('HALL_LAYERS '+JSON.stringify({time:introTime,visible}));lastVisibleLayers=key;}}
  }
  requestAnimationFrame(frame);
}
async function start(){
  try{
    ctx=new spine.ManagedWebGLRenderingContext(canvas,{alpha:true,premultipliedAlpha:true,antialias:true});
    shader=spine.Shader.newTwoColoredTextured(ctx);batcher=new spine.PolygonBatcher(ctx);renderer=new spine.SkeletonRenderer(ctx);matrix=new spine.Matrix4();
    requestAnimationFrame(frame);
    const catalog=await fetchOk(base+'catalog.json').then(r=>r.json());
    const prepared=prepareCatalog(catalog);entries=prepared.entries;groups=prepared.groups;
    try{const ac=await fetchOk(base+'audio-catalog.json').then(r=>r.json());if(ac.schemaVersion===1)audioCatalog=ac;}catch(e){console.log('HALL_AUDIO_PACK_MISSING');}
    if(audioCatalog){for(const b of Object.values(audioCatalog.bgms))option(el('bgm'),String(b.id),'BGM '+b.id+' · '+b.paths[0].split('/').pop().replace('.ogg',''));console.log('HALL_AUDIO_CATALOG '+JSON.stringify(audioCatalog.counts));}
    el('sound').disabled=!audioCatalog;el('bgm').disabled=!audioCatalog;
    try{const links=await fetchOk('/app/roster-links.json').then(r=>r.json());const annotated=annotateGroups(groups,links);el('roster-status').textContent='本包 '+annotated+' 组有表关联 · 其余保留内部标识';console.log('HALL_ROSTER '+JSON.stringify({annotated,tableCounts:links.counts}));}catch(e){console.warn('HALL_ROSTER_CONFIG '+e.message);}
    try{const config=await fetchOk('/app/compositions.json').then(r=>r.json());if(config.schemaVersion===1)recipes=config.recipes;}catch(e){console.warn('HALL_COMPOSITION_CONFIG '+e.message);}
    const openingCount=entries.filter(e=>recipes[e.id]&&recipes[e.id].layers.every(l=>entries.some(e=>e.id===l.id))).length;
    el('opening-status').textContent='本包 '+openingCount+' 个大厅支持开场预览';
    console.log('HALL_OPENING_COVERAGE '+JSON.stringify({available:openingCount,configured:Object.keys(recipes).length}));
    el('issues-title').textContent=`资源检查：${prepared.total} 个场景，${prepared.failures.length} 个暂不可用`;
    for(const f of prepared.failures){const p=document.createElement('p');p.textContent=f.id+'：'+f.error;el('issues-list').append(p);}
    if(!prepared.failures.length)el('issues-list').textContent='目录检查通过。实际显示效果仍以本机播放为准。';
    if(source==='pack')try{
      const status=await fetchOk('/app/opening-status.json').then(r=>r.json());
      const summary=document.createElement('p');summary.textContent='开场配置扫描：'+status.counts.prefabs+' 个场景，'+status.counts.generated+' 个已生成，'+status.counts.unsupported+' 个待处理（包含公共/剧情场景）。';el('issues-list').append(summary);
      for(const row of status.unsupported){
        const reason=row.reason.startsWith('Interleaved material')?'图层交错绘制待实现':row.reason.startsWith('Overlapping')?'重叠动画混合待实现':row.reason.startsWith('Catalog')?'缺少可用图集':row.reason.startsWith('No Spine')?'公共场景，没有骨骼动画':row.reason.startsWith('No referenced')?'未发现独立开场时间线':'依赖或动画结构待处理';
        const p=document.createElement('p');p.textContent=(row.prefabs?.map(p=>p.split('/').pop()).join(' / ')||row.bundle)+'：'+reason;el('issues-list').append(p);
      }
    }catch(e){console.warn('HALL_OPENING_STATUS '+e.message);}
    console.log('HALL_CATALOG '+JSON.stringify({source,total:prepared.total,playable:entries.length,groups:groups.length,failed:prepared.failures.length}));
    redrawList();
    const last=localStorage.getItem('last-'+source);const first=entries.find(s=>s.id===last)||entries.find(s=>s.sourceKey==='airi_home')||entries[0];
    if(first){mode=first.kind;redrawList();await loadScene(first);}else message('没有可播放的资源。请选择完整的本地资源包。');
  }catch(e){message('无法打开本地资源包：'+e.message+'\n请使用“导入资源包”选择含 catalog.json 的目录，或选择“内置样本”。');console.error(e);}
}
el('choose').onclick=()=>{location.href='offline://choose/';};
el('demo').onclick=()=>{location.href='/app/index.html?source=demo';};
el('pack').onclick=()=>{location.href='/app/index.html?source=pack';};
el('search').oninput=()=>{el('list').scrollTop=0;redrawList();};
for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>{
  mode=button.dataset.mode;localStorage.setItem('mode-'+source,mode);redrawList();
  const group=groups.find(g=>g.key===activeEntry?.groupKey);
  if(group){const next=pickScene(group,mode,activeEntry?.id);if(next&&next.id!==activeEntry?.id)loadScene(next);}
};
el('presentation').onchange=()=>{const entry=entries.find(s=>s.id===el('presentation').value);if(entry){mode=entry.kind;loadScene(entry);}};
el('favorites-filter').onclick=()=>{onlyFavorites=!onlyFavorites;localStorage.setItem('only-favorites',JSON.stringify(onlyFavorites));redrawList();};
el('toggle').onclick=()=>document.body.classList.toggle('closed');
el('modules-toggle').onclick=()=>{const menu=el('modules-menu');menu.hidden=!menu.hidden;el('modules-toggle').setAttribute('aria-expanded',String(!menu.hidden));};
window.addEventListener('pagehide',()=>{stopDialogue();audio.reset();audio.pause(true);});
let restoreLibrary=false;
function settingsOpen(open){
 if(open&&matchMedia('(max-width:1000px)').matches&&!document.body.classList.contains('closed')){restoreLibrary=true;document.body.classList.add('closed');}
 if(!open&&restoreLibrary){document.body.classList.remove('closed');restoreLibrary=false;}
 el('settings').hidden=!open;el('settings-toggle').setAttribute('aria-expanded',String(open));
}
el('settings-toggle').onclick=()=>settingsOpen(el('settings').hidden);
el('settings-close').onclick=()=>settingsOpen(false);
el('play').onclick=()=>{paused=!paused;audioPause();el('play').textContent=paused?'继续':'暂停';};
el('animation').onchange=()=>playAnimation(el('animation').value,true);
el('skin').onchange=()=>{if(current){current.skeleton.setSkinByName(el('skin').value);current.skeleton.setSlotsToSetupPose();current.state.apply(current.skeleton);current.skeleton.updateWorldTransform(spine.Physics.update);}};
el('interact').onclick=interact;
canvas.addEventListener('pointerdown',event=>{if(!drag){drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false};canvas.setPointerCapture(event.pointerId);}});
canvas.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  if(Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>6)drag.moved=true;
  if(drag.moved){panX-=(event.clientX-drag.x)*worldPerPixel;panY+=(event.clientY-drag.y)*worldPerPixel;}
  drag.x=event.clientX;drag.y=event.clientY;
});
canvas.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId){const clicked=!drag.moved;drag=null;if(clicked)interact();}});
canvas.addEventListener('pointercancel',()=>{drag=null;});
el('zoom').oninput=()=>{zoom=Number(el('zoom').value);};
el('fit').onclick=()=>{zoom=1;panX=0;panY=0;el('zoom').value=1;};
canvas.addEventListener('wheel',event=>{event.preventDefault();zoom=Math.max(.6,Math.min(4,zoom*Math.exp(-event.deltaY*.001)));el('zoom').value=zoom;},{passive:false});
el('reset').onclick=()=>{if(current)loadScene(current.entry);};
el('composite').onchange=()=>{compositionEnabled=el('composite').checked;if(activeEntry)loadScene(activeEntry);};
el('intro').onclick=playIntro;
el('favorite').onclick=()=>{if(!current)return;const id=current.entry.id;if(favorites.has(id))favorites.delete(id);else favorites.add(id);localStorage.setItem('favorites',JSON.stringify([...favorites]));el('favorite').textContent=favorites.has(id)?'★ 已收藏':'☆ 收藏';redrawList();};
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;++loading;controller?.abort();stopDialogue();audio.reset();audioPause();message('画面资源已被系统回收，正在等待恢复…');});
canvas.addEventListener('webglcontextrestored',()=>{location.reload();});
document.addEventListener('visibilitychange',()=>{frameTime=0;audioPause();});
el('sound').onclick=async()=>{if(audio.enabled)stopDialogue();await audio.toggle();el('sound').textContent=audio.enabled?'关闭声音':'开启声音';audioPause();if(audio.enabled)playBgm();};
el('voice-language').onclick=()=>{stopDialogue();if(current)resetToIdle();locale=locale==='cn'?'jp':'cn';localStorage.setItem('voice-locale',locale);el('voice-language').textContent='配音：'+languageLabel()+' ⇄';el('audio-status').textContent='已切换'+languageLabel()+'，下次对话生效';console.log('HALL_AUDIO_LOCALE '+locale);};
el('dialogue-play').onclick=()=>playDialogue(sceneAudio?.dialogs.find(d=>d.id===el('dialogue').value));
el('bgm').onchange=()=>{if(sceneAudio?.kind==='normal')localStorage.setItem('normal-bgm',el('bgm').value);playBgm();};
for(const id of ['voice-volume','bgm-volume']){el(id).value=localStorage.getItem(id)||(id==='voice-volume'?'1':'.35');el(id).oninput=()=>{localStorage.setItem(id,el(id).value);audio.volumes(Number(el('voice-volume').value),Number(el('bgm-volume').value));};}
audio.volumes(Number(el('voice-volume').value),Number(el('bgm-volume').value));
start();
