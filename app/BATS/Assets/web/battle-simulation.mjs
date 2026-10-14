// 本地战斗执行器。源动作/弹匣/EX 表与未恢复的伤害公式明确分开。
export const RULES=Object.freeze({id:'bats-combat-3',step:1/30,timeout:180,enemyLevel:10,speed:2.8,waveDelay:1,maxCost:10,costDivisor:10000});
export function prototypeStats(level,side,code=''){
 if(!Number.isInteger(level)||level<1||level>90||!['player','enemy'].includes(side))throw Error('战斗等级无效');
 return side==='player'?{hp:1200+40*level,attack:85+10*level,defense:20+2*level,range:5}:
  {hp:350+20*level,attack:35+3*level,defense:10+level,range:code.includes('_SMG_')?4:6};
}
export function damageAmount(attack,defense){if(!Number.isFinite(attack+defense)||attack<0||defense<0)throw Error('伤害参数无效');return Math.max(1,Math.floor(attack*100/(100+defense)));}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function insideFan(origin,point,yaw,range,angle){const d=distance(origin,point);return d<=range&&(d<1e-6||Math.abs(Math.atan2(Math.sin(Math.atan2(point.x-origin.x,point.z-origin.z)-yaw),Math.cos(Math.atan2(point.x-origin.x,point.z-origin.z)-yaw)))<=angle/2);}
export class BattleSimulation {
 constructor(nav,waves,team,enemyCatalog,profiles={}){
  if(!Array.isArray(team)||![4,6].includes(team.length)||new Set(team.map(t=>t.id)).size!==team.length||!Array.isArray(waves)||!waves.length)throw Error('编队或波次无效');
  this.nav=nav;this.waves=waves;this.enemyCatalog=enemyCatalog;this.profiles=profiles;
  this.time=0;this.units=[];this.supports=[];this.medicalBoxes=[];this.events=[];this.projectiles=[];this.pending=[];this.state='running';this.paused=false;this.wave=-1;this.nextWaveAt=null;this.kills=0;this.total=waves.reduce((n,w)=>n+w.spawns.length,0);this.pathRequests=0;this.pathsFailed=0;this.waveHistory=[];this.cost=0;this.spentCost=0;this.skillUses=0;this.shots=0;this.hits=0;this.reloads=0;this.serial=0;
  team.slice(0,4).forEach((t,i)=>{const p=nav.nearest(-.6+i*1.2,2.5-(i%2)*.9,4);if(!p)throw Error('己方起点缺少可走网格');this.units.push(this.unit({...t,...p,uid:'p'+i,side:'player',code:t.modelKey}));});
  team.slice(4).forEach((t,i)=>{const profile=profiles[t.modelKey];if(profile?.slot!=='special')throw Error('SPECIAL 位置需要支援角色');this.supports.push({...t,uid:'p'+(i+4),side:'support',profile,hp:1,skill:null,stats:{healing:80+8*t.level},x:0,z:0});});
  this.hand=['p0','p1','p2'];this.queue=['p3',...this.supports.map(u=>u.uid)];this.spawnWave();
 }
 unit(t){
  const profile=this.profiles[t.modelKey],stats=prototypeStats(t.level,t.side,t.code);
  if(t.side==='player'&&!profile?.ex)throw Error('此角色的武器与 EX 尚未接入：'+t.modelKey);
  const weapon=profile?.weapon||(t.code.includes('_SMG_')?'SMG':'MG');
  return {...t,profile,weapon,stats:{...stats,range:profile?.range||stats.range},hp:stats.hp,state:'idle',stateTime:0,role:'Normal_Idle',roleTime:0,yaw:t.side==='player'?0:Math.PI,cooldown:0,attack:null,path:[],pathTime:-Infinity,pathTarget:null,skill:null,ammo:profile?.magazine||30,maxAmmo:profile?.magazine||30,reloadRemaining:0};
 }
 emit(e){this.events.push({time:this.time,...e});if(this.events.length>4096)this.events.shift();}
 alive(side){return this.units.filter(u=>u.side===side&&u.hp>0);}
 change(u,state,role='Normal_Idle'){if(u.state!==state){u.state=state;u.stateTime=0;}if(u.role!==role){u.role=role;u.roleTime=0;}}
 spawnWave(){
  this.wave++;this.nextWaveAt=null;const w=this.waves[this.wave];this.waveHistory.push(w.commandRef);
  for(const [i,s] of w.spawns.entries()){
   const asset=this.enemyCatalog.find(e=>e.code===s.code);if(!asset)throw Error('敌方模型尚未接入：'+s.code);
   const raw=s.positionRaw,blocked=!this.nav.valid(this.nav.index(raw[1],raw[2])),chosen=blocked&&s.nestedPlacements.length?s.nestedPlacements[0].positionRaw:raw,p=this.nav.nearest(chosen[1],chosen[2],.5);
   if(!p)throw Error('敌方出生位置没有可走网格');
   this.units.push(this.unit({...asset,...p,level:RULES.enemyLevel,uid:'e'+this.wave+'-'+i,side:'enemy',sourcePosition:raw,entryUsesNested:chosen!==raw}));
  }this.emit({type:'wave',index:this.wave,commandRef:w.commandRef,count:w.spawns.length});
 }
 // BA 默认自动移动；无点地面移动 API。点战场只用于 EX 选取目标/方向。
 targetFor(u){return this.alive(u.side==='player'?'enemy':'player').sort((a,b)=>distance(a,u)-distance(b,u)).find(t=>distance(t,u)<=u.stats.range&&this.nav.line(u,t))||this.alive(u.side==='player'?'enemy':'player').sort((a,b)=>distance(a,u)-distance(b,u))[0];}
 card(slot){const u=[...this.units,...this.supports].find(u=>u.uid===this.hand[slot]);return u?.hp>0&&u.profile?.ex?u:null;}
 canCast(slot){const u=this.card(slot);return Boolean(this.state==='running'&&!this.paused&&u&&!u.skill&&this.cost+1e-9>=u.profile.ex.cost);}
 aim(slot,p){
  const u=this.card(slot);if(!u||!p||!Number.isFinite(p.x+p.z))return null;const ex=u.profile.ex;
  if(u.side==='support'){if(!this.nav.valid(this.nav.index(p.x,p.z)))return null;const allies=this.alive('player');if(!allies.length)return null;const target=allies.sort((a,b)=>distance(a,p)-distance(b,p))[0];return ex.shape==='heal-ground'?{x:p.x,z:p.z,target:target.uid,yaw:0}:{x:p.x,z:p.z,targets:allies.filter(t=>distance(t,p)<=ex.radius).map(t=>t.uid),yaw:0};}
  if(ex.shape.startsWith('target')){
   const target=this.alive('enemy').filter(t=>distance(t,p)<=1.1&&distance(t,u)<=ex.range&&this.nav.line(u,t)).sort((a,b)=>distance(a,p)-distance(b,p))[0];
   return target?{target:target.uid,x:target.x,z:target.z,yaw:Math.atan2(target.x-u.x,target.z-u.z)}:null;
  }
  if(distance(u,p)<.1)return null;const yaw=Math.atan2(p.x-u.x,p.z-u.z);
  const targets=this.alive('enemy').filter(t=>insideFan(u,t,yaw,ex.range,ex.angle)&&this.nav.line(u,t));
  return targets.length?{x:p.x,z:p.z,yaw,targets:targets.map(t=>t.uid)}:null;
 }
 cast(slot,p){
  if(!this.canCast(slot))return false;const a=this.aim(slot,p),u=this.card(slot);if(!a)return false;const ex=u.profile.ex;
  this.cost=Math.max(0,this.cost-ex.cost);this.spentCost+=ex.cost;this.skillUses++;
  u.attack=null;u.path=[];u.reloadRemaining=0;u.skill={...a,elapsed:0,next:0};u.yaw=a.yaw;this.change(u,'skill','Exs');u.roleTime=0;if(u.side==='support'){u.skill.elapsed=0;u.skill.applied=false;}
  const spent=this.hand[slot];this.hand[slot]=this.queue.shift();this.queue.push(spent);
  this.emit({type:'skill',uid:u.uid,name:ex.name,cost:ex.cost,x:a.x,z:a.z,shape:ex.shape});return true;
 }
 costRate(){return [...this.alive('player'),...this.supports].reduce((n,u)=>n+(u.profile?.costRecoveryStat||0),0)/RULES.costDivisor;}
 shoot(u,target,multiplier=1,kind=u.weapon,extra={}){
  if(target.hp<=0)return;
  const start=u.muzzle&&Number.isFinite(u.muzzle.x+u.muzzle.y+u.muzzle.z)?{...u.muzzle}:{x:u.x,y:1,z:u.z};
  if(kind==='missile'){start.x=u.x;start.z=u.z;start.y=2.8;}
  const end={x:target.x,y:.9,z:target.z},duration=Math.max(.06,distance(start,end)/(kind==='missile'?11:u.profile?.bulletSpeed||30));
  const p={id:++this.serial,from:u.uid,to:target.uid,start,end,born:this.time,duration,kind,damage:damageAmount(u.stats.attack*(u.attackBuffUntil>this.time?1+u.attackBuff:1)*multiplier,target.stats.defense),...extra};
  this.projectiles.push(p);this.shots++;this.emit({type:'shot',from:u.uid,to:target.uid,weapon:kind,start,end,projectile:p.id});
 }
 hurt(target,damage,from,kind='normal'){
  if(!target||target.hp<=0)return;
  target.hp=Math.max(0,target.hp-damage);this.hits++;this.emit({type:'hit',from,to:target.uid,damage,x:target.x,z:target.z,kind});
  if(!target.hp){target.attack=null;target.skill=null;target.path=[];target.reloadRemaining=0;target.deadAt=this.time;this.change(target,'dead','Vital_Death');if(target.side==='enemy')this.kills++;this.emit({type:'death',uid:target.uid});}
 }
 advanceSkill(u,dt){
  const s=u.skill,ex=u.profile.ex;s.elapsed+=dt;
  while(s.next<ex.shotTimes.length&&s.elapsed+1e-8>=ex.shotTimes[s.next]){
   const n=ex.shotTimes.length;
   if(ex.shape==='fan'){
    for(const t of this.alive('enemy'))if(insideFan(u,t,s.yaw,ex.range,ex.angle)&&this.nav.line(u,t))this.shoot(u,t,ex.multiplier/n,u.weapon,{skill:true});
    this.emit({type:'fan',uid:u.uid,x:u.x,z:u.z,yaw:s.yaw,range:ex.range,angle:ex.angle});
   }else{
    const target=this.units.find(t=>t.uid===s.target);
    if(target?.hp>0)this.shoot(u,target,ex.multiplier,u.weapon==='AR'?'missile':u.weapon,{skill:true});
    if(ex.splashMultiplier)this.pending.push({at:this.time+ex.explosionTime-ex.shotTimes[s.next],from:u.uid,x:s.x,z:s.z,radius:ex.radius,attack:u.stats.attack*ex.splashMultiplier});
   }s.next++;
  }
  if(s.elapsed>=ex.castDuration){u.skill=null;this.change(u,'idle');}
 }
 beginReload(u){u.attack=null;u.reloadRemaining=u.profile?.durations.Normal_Reload||u.reloadDuration||2.3;this.reloads++;this.change(u,'reload','Normal_Reload');u.roleTime=0;this.emit({type:'reload',uid:u.uid,weapon:u.weapon});}
 advanceAttack(u,dt){
  const a=u.attack,target=this.units.find(t=>t.uid===a.target);a.elapsed+=dt;
  if(!target||target.hp<=0||distance(u,target)>u.stats.range+.3||!this.nav.line(u,target)){u.attack=null;this.change(u,'idle');return;}
  u.yaw=Math.atan2(target.x-u.x,target.z-u.z);
  const start=u.profile?.durations.Normal_Attack_Start||.25,ing=u.profile?.durations.Normal_Attack_Ing||.7;
  if(a.elapsed<start){this.change(u,'attack','Normal_Attack_Start');u.roleTime=a.elapsed;return;}
  this.change(u,'attack','Normal_Attack_Ing');u.roleTime=a.elapsed-start;
  const burst=Math.min(u.ammo+a.fired,u.profile?.burst||(u.weapon==='MG'?6:3));
  while(a.fired<burst&&a.elapsed-start+1e-8>=a.fired*ing/Math.max(1,burst)){
   const pellets=u.weapon==='SG'?6:1;
   for(let i=0;i<pellets;i++)this.shoot(u,target,1/burst/pellets,u.weapon,{pellet:i,pellets});
   a.fired++;u.ammo--;
  }
  if(a.elapsed>=start+ing){u.attack=null;u.cooldown=.15;this.change(u,'recover','Normal_Attack_End');u.roleTime=0;}
 }
 step(dt=RULES.step){
  if(!Number.isFinite(dt)||dt<=0||dt>RULES.step+1e-9)throw Error('战斗步长无效');if(this.paused||this.state!=='running')return;
  this.time+=dt;this.cost=Math.min(RULES.maxCost,this.cost+this.costRate()*dt);
  for(const u of this.units){u.roleTime+=dt;u.stateTime+=dt;if(u.hp<=0)continue;u.cooldown=Math.max(0,u.cooldown-dt);
   if(u.skill){this.advanceSkill(u,dt);continue;}
   if(u.reloadRemaining>0){u.reloadRemaining=Math.max(0,u.reloadRemaining-dt);if(u.reloadRemaining===0){u.ammo=u.maxAmmo;this.change(u,'idle');}continue;}
   if(u.attack){this.advanceAttack(u,dt);continue;}
   if(u.medicalTarget){const box=this.medicalBoxes.find(b=>b.id===u.medicalTarget);if(!box)u.medicalTarget=null;else if(distance(u,box)<.55){const before=u.hp;u.hp=Math.min(u.stats.hp,u.hp+box.healing);this.emit({type:'heal',uid:u.uid,x:u.x,z:u.z,amount:u.hp-before});this.medicalBoxes=this.medicalBoxes.filter(b=>b!==box);u.medicalTarget=null;u.path=[];this.change(u,'idle');}else{if(u.pathTarget!==box.id){u.path=this.nav.path(u,box)||[];u.pathTarget=box.id;this.pathRequests++;}this.move(u,dt);continue;}}
   const target=this.targetFor(u);if(!target){this.change(u,'idle');continue;}
   u.yaw=Math.atan2(target.x-u.x,target.z-u.z);
   if(distance(u,target)<=u.stats.range&&this.nav.line(u,target)){
    u.path=[];if(!u.ammo){this.beginReload(u);continue;}
    if(u.cooldown===0){u.attack={target:target.uid,elapsed:0,fired:0};this.change(u,'attack','Normal_Attack_Start');u.roleTime=0;}
   }else{
    if(this.time-u.pathTime>.75||u.pathTarget!==target.uid){u.pathTime=this.time;u.pathTarget=target.uid;this.pathRequests++;u.path=this.nav.path(u,target)||[];if(!u.path.length)this.pathsFailed++;}
    this.move(u,dt);
   }
  }
  for(const support of this.supports){const skill=support.skill;if(!skill)continue;skill.elapsed+=dt;if(!skill.applied&&skill.elapsed>=support.profile.ex.castDuration){skill.applied=true;const ex=support.profile.ex;
   if(ex.shape==='heal-ground'){const target=this.units.find(u=>u.uid===skill.target&&u.hp>0)||this.alive('player').sort((a,b)=>distance(a,skill)-distance(b,skill))[0];if(target){const box={id:'medical-'+(++this.serial),x:skill.x,z:skill.z,healing:support.stats.healing*ex.healingMultiplier,born:this.time};this.medicalBoxes.push(box);target.medicalTarget=box.id;target.pathTarget=null;target.attack=null;this.emit({type:'medical-drop',uid:support.uid,...box});}}
   else for(const target of this.alive('player').filter(u=>distance(u,skill)<=ex.radius)){target.attackBuff=ex.attackBuff;target.attackBuffUntil=this.time+ex.buffDuration;this.emit({type:'buff',uid:target.uid,from:support.uid,x:target.x,z:target.z,multiplier:ex.attackBuff,duration:ex.buffDuration});}
   support.skill=null;}}
  const flying=[];
  for(const p of this.projectiles){if(this.time-p.born>=p.duration){const target=this.units.find(t=>t.uid===p.to);if(target?.hp>0&&distance(target,p.end)<1.6)this.hurt(target,p.damage,p.from,p.skill?'EX':'normal');}else flying.push(p);}this.projectiles=flying;
  const pending=[];for(const e of this.pending){if(this.time>=e.at){for(const t of this.alive('enemy'))if(distance(t,e)<=e.radius)this.hurt(t,damageAmount(e.attack,t.stats.defense),e.from,'EX');this.emit({type:'explosion',...e});}else pending.push(e);}this.pending=pending;
  const live=this.units.filter(u=>u.hp>0&&!u.skill);
  for(let a=0;a<live.length;a++)for(let b=a+1;b<live.length;b++){const u=live[a],v=live[b];let dx=v.x-u.x,dz=v.z-u.z,d=Math.hypot(dx,dz),original=d;if(d>=.65)continue;if(d<1e-6){dx=a%2?1:-1;dz=.25;d=Math.hypot(dx,dz);}const amount=Math.min((.65-original)/2,dt*2),x=dx/d*amount,z=dz/d*amount;for(const [unit,p] of [[u,{x:u.x-x,z:u.z-z}],[v,{x:v.x+x,z:v.z+z}]])if(this.nav.line(unit,p)){unit.x=p.x;unit.z=p.z;}}
  if(!this.alive('player').length){this.state='defeat';this.emit({type:'result',state:this.state});}
  else if(!this.alive('enemy').length&&!this.projectiles.length&&!this.pending.length){if(this.wave===this.waves.length-1){this.state='victory';this.emit({type:'result',state:this.state});}else{this.nextWaveAt??=this.time+RULES.waveDelay;if(this.time>=this.nextWaveAt)this.spawnWave();}}
  if(this.state==='running'&&this.time>=RULES.timeout){this.state='timeout';this.emit({type:'result',state:this.state});}
 }
 move(u,dt){let remaining=RULES.speed*dt;while(u.path.length&&remaining>0){const p=u.path[0],d=distance(p,u);if(d<1e-6){u.path.shift();continue;}const travel=Math.min(d,remaining),x=u.x+(p.x-u.x)*travel/d,z=u.z+(p.z-u.z)*travel/d;if(!this.nav.line(u,{x,z})){u.path=[];this.pathsFailed++;break;}u.yaw=Math.atan2(p.x-u.x,p.z-u.z);u.x=x;u.z=z;remaining-=travel;if(travel>=d-1e-9)u.path.shift();}this.change(u,u.path.length?'move':'idle',u.path.length?'Move_Ing':'Normal_Idle');}
 snapshot(){return {supports:this.supports.map(u=>({uid:u.uid,id:u.id,modelKey:u.modelKey,level:u.level,skill:Boolean(u.skill)})),medicalBoxes:this.medicalBoxes.map(b=>({...b})),state:this.state,paused:this.paused,time:this.time,wave:this.wave,kills:this.kills,total:this.total,pathRequests:this.pathRequests,pathsFailed:this.pathsFailed,hits:this.hits,shots:this.shots,reloads:this.reloads,cost:this.cost,costRate:this.costRate(),spentCost:this.spentCost,skillUses:this.skillUses,hand:[...this.hand],queue:[...this.queue],projectiles:this.projectiles.length,units:this.units.map(u=>({uid:u.uid,id:u.id,side:u.side,hp:u.hp,maxHP:u.stats.hp,x:u.x,z:u.z,state:u.state,role:u.role,level:u.level,weapon:u.weapon,ammo:u.ammo,maxAmmo:u.maxAmmo}))};}
}
