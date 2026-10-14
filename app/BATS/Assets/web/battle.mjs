import {BattleEffects} from './battle-effects.mjs';
import {BattleAudio} from './battle-audio.mjs';
import {PRESENTATION_RULES} from './battle-cutins.mjs';
import {NavigationGrid} from './battle-navigation.mjs';
import {BattleSimulation,RULES} from './battle-simulation.mjs';
import {BattleRenderer} from './battle-renderer.mjs';
import {loadConfig,parseLevel,levelFor,setLevel} from './bats-config.mjs';
const el=id=>document.getElementById(id),KEY='bats-character-config-v1',controls=[],cards=[];
let cutins,audio,cutin=null,audioEvent=0,previousStates=new Map();
let data,config,nav,waves,enemies,renderer,sim,profiles,choices=[],started=false,loading=false,hostPaused=false,last=0,accumulator=0,lastUI=0,resultLogged=false,selected=-1,aimPoint=null,auto=false,lastAuto=0;
const states={running:'自动移动与普攻',victory:'胜利 · 首场遭遇完成',defeat:'失败 · 己方全部倒下',timeout:'失败 · 战斗超时'};
function syncAudio(){audio?.pause(Boolean(hostPaused||document.hidden||sim?.paused));}
window.hallHostPause=value=>{hostPaused=value;last=0;syncAudio();};document.addEventListener('visibilitychange',()=>{last=0;syncAudio();});
el('panel-toggle').onclick=()=>{document.body.classList.toggle('panel-collapsed');el('panel-toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('panel-collapsed')));};
async function get(name){const r=await fetch('/app/'+name);if(!r.ok)throw Error('本地战斗配置缺失：'+name);return r.json();}
function cancel(){selected=-1;aimPoint=null;if(renderer)renderer.aim=null;el('aim-hint').hidden=true;}
function fail(error){if(sim)sim.paused=true;audio?.stop();syncAudio();endCutin();cancel();el('battle-status').textContent='未能运行：'+error.message;el('battle-overlay').hidden=false;el('battle-overlay').textContent=error.message;console.error('BATS_BATTLE_ERROR '+error.message);}
function team(){const rows=controls.map(c=>{const row=choices.find(r=>String(r.id)===c.picker.value);if(!row)throw Error('角色目录不匹配');return {...row,slot:profiles[row.modelKey].slot,level:parseLevel(c.level.value,data.levelRange)};});if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('请为六个位置选择不同角色');return rows;}
function hint(text){el('battle-status').textContent=text;}
function updateAim(p){
 if(selected<0||!sim)return;const unit=sim.card(selected);if(!unit){cancel();return;}aimPoint=p;const aim=sim.aim(selected,p),ex=unit.profile.ex;
 renderer.aim={unit,ex,valid:Boolean(aim),point:aim||{...p,yaw:Math.atan2(p.x-unit.x,p.z-unit.z)}};
 el('aim-text').textContent=ex.name+' · '+(aim?'点击确认，消耗 '+ex.cost+' COST':'此处没有可选敌人，请调整范围');
}
function automaticTarget(unit){if(unit?.side==='support'){const allies=sim.alive('player');return unit.profile.ex.shape==='heal-ground'?allies.sort((a,b)=>a.hp/a.stats.hp-b.hp/b.stats.hp)[0]:{x:allies.reduce((v,u)=>v+u.x,0)/allies.length,z:allies.reduce((v,u)=>v+u.z,0)/allies.length};}return sim.targetFor(unit);}
function selectCard(slot){
 if(cutin)return;
 if(slot===selected){cancel();refresh();return;}if(!sim.canCast(slot))return;selected=slot;el('aim-hint').hidden=false;
 const u=sim.card(slot),t=automaticTarget(u);if(t)updateAim({x:t.x,z:t.z});refresh();
}
function refresh(){
 if(!sim)return;
 const seconds=Math.max(0,Math.ceil(RULES.timeout-sim.time));el('battle-clock').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');el('battle-enemies').textContent=String(sim.total-sim.kills);
 el('battle-status').textContent=!started?'已准备 · 点击开始战斗':sim.paused?'已暂停':cutin?'EX 技能演出 · 战场减速':selected>=0?'选择 EX 目标 · 战斗减速':states[sim.state];el('battle-count').textContent=`遭遇 ${sim.wave+1}/3 · 击倒 ${sim.kills}/${sim.total} · 己方 ${sim.alive('player').length}/4`;
 el('battle-pause').textContent=started&&sim.paused?'▶':'Ⅱ';el('battle-pause').setAttribute('aria-label',started&&sim.paused?'继续战斗':'暂停战斗');el('battle-pause').disabled=!started||sim.state!=='running'||loading;el('battle-start').disabled=loading||started&&sim.state==='running';el('battle-start').hidden=started&&sim.state==='running';el('battle-retry').disabled=loading;
 for(const c of controls){c.picker.disabled=loading||started&&sim.state==='running';c.level.disabled=c.picker.disabled;}
 el('cost-value').textContent=String(Math.min(10,Math.floor(sim.cost+1e-8)));el('cost-gauge').setAttribute('aria-valuenow',sim.cost.toFixed(2));
 for(let i=0;i<10;i++)el('cost-gauge').children[i].firstChild.style.width=Math.max(0,Math.min(1,sim.cost-i))*100+'%';
 for(let i=0;i<3;i++){
  const u=[...sim.units,...sim.supports].find(u=>u.uid===sim.hand[i]),card=cards[i],p=u?.profile;
  card.button.disabled=!started||loading||Boolean(cutin)||!sim.canCast(i);card.button.classList.toggle('dead',!u||u.hp<=0);card.button.classList.toggle('selected',i===selected);card.button.dataset.uid=u?.uid||'';card.button.setAttribute('aria-label',(u?.name||'空位')+' EX COST '+(p?.ex.cost||0));
  card.name.textContent=u?.name||'不可用';card.cost.textContent=String(p?.ex.cost||0);card.image.src=p?.portrait?'/app/'+p.portrait:'';card.button.title=p?.ex.description.replace(/\[[^\]]*\]/g,'')||'';
 }el('next-name').textContent=[...sim.units,...sim.supports].find(u=>u.uid===sim.queue[0])?.name||'—';
 if(selected>=0&&!sim.canCast(selected))cancel();
 if(started&&!cutin&&sim.state!=='running'){cancel();el('battle-overlay').hidden=false;el('battle-overlay').textContent=states[sim.state]+'\n'+sim.time.toFixed(1)+' 秒 · 点击重试';if(!resultLogged){audio.cue(sim.alive('player')[0]?.modelKey||sim.units[0].modelKey,sim.state==='victory'?'victory':'defeat',{priority:true,time:sim.time});console.log('BATS_BATTLE_RESULT '+JSON.stringify(sim.snapshot()));resultLogged=true;}}
}
async function reset(play,save){
 if(loading)return;loading=true;endCutin();audio?.reset();previousStates.clear();audioEvent=0;el('battle-start').disabled=el('battle-retry').disabled=true;cancel();if(sim)sim.paused=true;el('battle-overlay').hidden=false;el('battle-overlay').textContent='正在加载本地编队…';
 try{
  const rows=team(),next=new BattleSimulation(nav,waves,rows,enemies,profiles);
  for(const row of rows)await renderer.load('student-models/'+row.modelKey+'/',row.slot==='special');for(const e of enemies)await renderer.load(e.base);
  if(save){let nextConfig=loadConfig(localStorage.getItem(KEY),data.characters,data.levelRange);for(const row of rows)nextConfig=setLevel(nextConfig,row.id,row.level,data.characters,data.levelRange);localStorage.setItem(KEY,JSON.stringify(nextConfig));config=nextConfig;}
  sim=next;sim.paused=!play;if(play){await audio.enable();audio.preload(rows.map(r=>r.modelKey));audio.cue(rows[0].modelKey,'start',{priority:true});}syncAudio();started=play;accumulator=0;last=0;lastAuto=0;resultLogged=false;el('battle-overlay').hidden=true;
  console.log('BATS_BATTLE_READY '+JSON.stringify({version:'0.8',encounter:101110101,players:rows.map(r=>({id:r.id,level:r.level,model:r.modelKey})),enemies:enemies.map(e=>e.modelKey),gridNodes:nav.data.sourceNodes,rules:RULES.id,sourceMappingConfirmed:false}));
 }catch(e){fail(e);}finally{loading=false;refresh();}
}
el('battle-start').onclick=()=>reset(true,true);el('battle-retry').onclick=()=>reset(true,true);el('battle-pause').onclick=()=>{if(sim){sim.paused=!sim.paused;accumulator=0;last=0;cancel();syncAudio();refresh();}};
el('skill-cancel').onclick=()=>{cancel();refresh();};el('skill-auto').onclick=()=>{auto=!auto;el('skill-auto').setAttribute('aria-pressed',String(auto));el('skill-auto').innerHTML='自动<br>'+(auto?'ON':'OFF');cancel();};
function endCutin(){cutin=null;document.body.classList.remove('cutin-active');el('cutin-caption').hidden=true;el('cutin-pause').hidden=true;}
function beginCutin(unit){
 const data=cutins.models[unit.modelKey];if(!data)throw Error('此角色缺少 EX 演出');cutin={unit,data,elapsed:0,voiced:false,sfxPlayed:new Set()};cancel();document.body.classList.add('cutin-active');el('cutin-caption').textContent=unit.name+' · '+unit.profile.ex.name;el('cutin-caption').hidden=false;el('cutin-pause').hidden=false;audio.stop();console.log('BATS_EX_CUTIN '+JSON.stringify({model:unit.modelKey,duration:data.duration,locale:audio.locale,combatScale:PRESENTATION_RULES.cutinScale}));
}
function castSkill(slot,point){if(cutin)return false;const unit=sim.card(slot);if(!sim.cast(slot,point))return false;beginCutin(unit);return true;}
function stateVoices(){
 for(const event of sim.events.slice(audioEvent)){const unit=sim.units.find(u=>u.uid===(event.type==='hit'?event.to:event.from||event.uid));if(unit?.side==='player'&&!cutin){if(event.type==='hit')audio.cue(unit.modelKey,'damage',{time:sim.time});else if(event.type==='death')audio.cue(unit.modelKey,'retire',{priority:true,time:sim.time});else if(event.type==='shot'&&!event.weapon.includes('missile'))audio.cue(unit.modelKey,'shot',{time:sim.time});}}
 audioEvent=sim.events.length;
 for(const unit of sim.alive('player')){if(unit.state==='move'&&previousStates.get(unit.uid)!=='move'&&!cutin)audio.cue(unit.modelKey,'move',{time:sim.time});previousStates.set(unit.uid,unit.state);}
}
el('cutin-pause').onclick=()=>el('battle-pause').click();
function audioLabels(){el('battle-language').textContent='配音：'+(audio.locale==='cn'?'中配':'日配')+' ⇄';el('battle-sound').textContent='声音：'+(audio.enabled?'开':'关');}
el('battle-language').onclick=async()=>{await audio.switchLocale();audioLabels();if(cutin)cutin.voiced=true;audio.preload(choices.map(r=>r.modelKey));};
el('battle-sound').onclick=async()=>{audio.enabled=!audio.enabled;localStorage.setItem('bats-battle-sound',audio.enabled?'on':'off');if(audio.enabled)await audio.enable();else audio.stop();syncAudio();audioLabels();};
function pointerPoint(event){
 const bounds=el('battle-canvas').getBoundingClientRect(),x=event.clientX-bounds.left,y=event.clientY-bounds.top,unit=sim.card(selected),ex=unit?.profile.ex;
 if(ex?.shape.startsWith('target')){
  const scale=renderer.hud.width/bounds.width,targets=sim.alive('enemy').map(t=>({t,p:renderer.project(t.x,t.z,.8)})).sort((a,b)=>Math.hypot(a.p.x/scale-x,a.p.y/scale-y)-Math.hypot(b.p.x/scale-x,b.p.y/scale-y));
  if(targets[0]&&Math.hypot(targets[0].p.x/scale-x,targets[0].p.y/scale-y)<45)return {x:targets[0].t.x,z:targets[0].t.z};
 }return renderer.world(x,y);
}
el('battle-canvas').onpointermove=event=>{if(selected>=0){const p=pointerPoint(event);if(p)updateAim(p);}};
el('battle-canvas').onpointerup=event=>{
 if(selected<0||!sim||!started||loading||sim.paused||sim.state!=='running')return;const p=pointerPoint(event);if(!p)return;
 if(castSkill(selected,p)){console.log('BATS_EX_CAST '+JSON.stringify({time:sim.time,spentCost:sim.spentCost,skillUses:sim.skillUses}));cancel();refresh();}else{updateAim(p);hint('没有有效目标，COST 未消耗');}
};
window.addEventListener('keydown',event=>{if(event.key==='Escape'){cancel();refresh();}else if(['1','2','3'].includes(event.key)&&event.target.tagName!=='INPUT'&&event.target.tagName!=='SELECT')selectCard(Number(event.key)-1);});
el('battle-canvas').addEventListener('webglcontextlost',event=>{event.preventDefault();renderer.lost=true;fail(Error('图形资源被系统回收，请重新进入战斗页'));});window.addEventListener('pagehide',()=>{audio?.dispose();renderer?.dispose();});
function frame(now){
 const dt=last?Math.min((now-last)/1000,.15):0;last=now;
 if(sim&&!loading&&!document.hidden&&!hostPaused&&!renderer.lost){try{
  if(started&&!sim.paused){
   if(cutin){cutin.elapsed+=dt;if(!cutin.voiced&&cutin.elapsed>=cutin.data.voice.start){cutin.voiced=true;audio.cue(cutin.unit.modelKey,'ex',{priority:true,time:sim.time});}for(const cue of cutin.data.sfx||[])if(cutin.elapsed>=cue.start&&!cutin.sfxPlayed.has(cue.path)){cutin.sfxPlayed.add(cue.path);audio.effect(cue);}if(cutin.elapsed>=cutin.data.duration)endCutin();}
  }
  if(started&&!sim.paused&&sim.state==='running'){
   accumulator+=dt*Number(el('battle-speed').value)*(cutin?PRESENTATION_RULES.cutinScale:selected>=0?PRESENTATION_RULES.aimScale:1);
   while(accumulator>=RULES.step){sim.step();accumulator-=RULES.step;
    if(auto&&!cutin&&sim.time-lastAuto>.4){lastAuto=sim.time;for(let slot=0;slot<3;slot++)if(sim.canCast(slot)){const u=sim.card(slot),t=automaticTarget(u);if(t&&castSkill(slot,{x:t.x,z:t.z}))break;}}
   }
  }stateVoices();if(selected>=0&&aimPoint)updateAim(aimPoint);if(cutin)renderer.drawCutIn(cutin.data,cutin.unit,cutin.elapsed);else renderer.draw(sim,dt,started&&!sim.paused&&sim.state==='running'?accumulator:0);if(sim.state!=='running'||now-lastUI>120){refresh();lastUI=now;}
 }catch(e){fail(e);}}requestAnimationFrame(frame);
}
async function init(){try{
 const [d,e,grid,eventCatalog,models,actions,profileData,enemyActions,cutinData,audioData,supportData,effectData]=await Promise.all(['bats-data.json','battle-enemy-catalog.json','battle-navigation.json','battle-event-catalog.json','model-catalog.json','combat-actions.json','combat-profiles.json','enemy-combat-actions.json','combat-cutins.json','combat-audio.json','support-profiles.json','combat-effects.json'].map(get));data=d;enemies=e.enemies.map(row=>({...row,reloadDuration:enemyActions.models[row.modelKey]?.clips.find(c=>c.kind==='Normal_Reload')?.duration}));profiles={...profileData.profiles,...supportData.profiles};cutins=cutinData;audio=new BattleAudio(audioData,text=>el('battle-audio-status').textContent=text);audioLabels();
 if(e.schemaVersion!==1||e.encounterId!==101110101||enemies.length!==2||actions.schemaVersion!==1||profileData.schemaVersion!==1)throw Error('战斗资源版本不匹配');
 nav=new NavigationGrid(grid);waves=eventCatalog.encounters.find(e=>e.id===101110101)?.waves;if(!waves||waves.length!==3)throw Error('首场波次缺失');
 choices=models.students.filter(r=>profiles[r.modelKey]&&r.status==='ready');if(choices.length!==6)throw Error('本轮六人动作/技能不足');config=loadConfig(localStorage.getItem(KEY),data.characters,data.levelRange);el('roster-note').textContent='前排 4 位 STRIKER，后排 2 位 SPECIAL 不在战场站位；本轮支持芹娜治疗与小玉攻击增益。';
 const preferred=['aru_original','shiroko_original','hoshino_original','hina_original','serina_original','kotama_original'];
 for(let i=0;i<6;i++){
  const card=document.createElement('div');card.className='member';const label=document.createElement('label');label.textContent=i<4?'STRIKER '+(i+1):'SPECIAL '+(i-3);const picker=document.createElement('select');picker.id='battle-member-'+i;picker.setAttribute('aria-label','位置 '+(i+1)+' 角色');for(const row of choices.filter(row=>Boolean(profiles[row.modelKey].slot==='special')===(i>=4)))picker.add(new Option(row.name+' · '+profiles[row.modelKey].weapon,String(row.id)));const row=choices.find(r=>r.modelKey===preferred[i]);picker.value=String(row.id);
  const line=document.createElement('label');line.textContent='等级';const level=document.createElement('input');level.id='battle-level-'+i;level.type='number';level.min=1;level.max=90;level.step=1;level.value=levelFor(config,row.id,data.levelRange);level.setAttribute('aria-label','位置 '+(i+1)+' 等级');picker.onchange=()=>level.value=levelFor(config,Number(picker.value),data.levelRange);line.append(level);card.append(label,picker,line);el('team').append(card);controls.push({picker,level});
 }
 for(const p of Object.values(profiles)){const paragraph=document.createElement('p');paragraph.textContent=p.name+' · '+p.weapon+' · 弹匣 '+p.magazine+' · '+p.ex.name+'（'+p.ex.cost+' COST）\n'+p.ex.description.replace(/\[[^\]]*\]/g,'');el('profile-note').append(paragraph);}
 for(let i=0;i<3;i++){const button=document.createElement('button');button.className='skill-card';button.id='skill-card-'+i;const image=document.createElement('img');image.alt='';const cost=document.createElement('span');cost.className='card-cost';const name=document.createElement('span');name.className='card-name';button.append(image,cost,name);button.onclick=()=>selectCard(i);el('skill-cards').append(button);cards.push({button,image,cost,name});}
 for(let i=0;i<10;i++){const segment=document.createElement('span');segment.className='cost-segment';segment.append(document.createElement('i'));el('cost-gauge').append(segment);}
 renderer=new BattleRenderer(el('battle-canvas'),el('battle-hud'),nav);renderer.actions={...actions.models,...enemyActions.models};renderer.actorMaterialStates=Object.fromEntries(Object.entries(cutins.models).map(([key,value])=>[key,value.materialStates]));await renderer.loadScene();renderer.effects=new BattleEffects(renderer,effectData);await renderer.effects.preload(cutins);
 window.batsBattle=Object.freeze({snapshot:()=>sim?.snapshot(),metrics:()=>structuredClone(renderer.metrics),selection:()=>selected,cutin:()=>cutin?{model:cutin.unit.modelKey,elapsed:cutin.elapsed,duration:cutin.data.duration}:null,audio:()=>({locale:audio.locale,enabled:audio.enabled,state:audio.context?.state,log:structuredClone(audio.log)}),events:()=>structuredClone(sim?.events||[]),view:()=>({center:[...renderer.camera.center],distance:renderer.camera.distance}),rules:RULES.id});
 await reset(false,false);requestAnimationFrame(frame);
}catch(e){fail(e);}}
init();
