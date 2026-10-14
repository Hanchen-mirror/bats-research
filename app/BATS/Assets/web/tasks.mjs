import {loadConfig,parseLevel,levelFor,setLevel} from './bats-config.mjs';
const el=id=>document.getElementById(id),KEY='bats-character-config-v1';let data,config;
function report(text){el('config-status').textContent=text;}
function save(next){try{localStorage.setItem(KEY,JSON.stringify(next));config=next;report('已保存到 BATS 本地');console.log('BATS_CONFIG_SAVED '+JSON.stringify({count:Object.keys(config.levels).length}));return true;}catch{report('未保存：本机存储不可用，请保留当前页面后重试。');return false;}}
function students(){
 const query=el('roster-search').value.trim().toLowerCase();el('roster').replaceChildren();
 for(const c of data.characters.filter(c=>[c.name,c.key,String(c.id)].some(v=>v.toLowerCase().includes(query)))){
  const card=document.createElement('article');card.className='student';const title=document.createElement('strong');title.textContent=c.name;card.append(title);
  const sub=document.createElement('small');sub.textContent=c.key+' · '+c.id;card.append(sub);
  const label=document.createElement('label');label.append('角色等级');const input=document.createElement('input');input.type='number';input.min=data.levelRange.min;input.max=data.levelRange.max;input.step=1;input.value=levelFor(config,c.id,data.levelRange);input.id='level-'+c.id;input.setAttribute('aria-label',c.name+'的等级');
  input.onchange=()=>{try{const next=setLevel(config,c.id,input.value,data.characters,data.levelRange);if(!save(next))input.value=levelFor(config,c.id,data.levelRange);}catch(e){report(e.message);input.value=levelFor(config,c.id,data.levelRange);}};label.append(input);card.append(label);const apply=document.createElement('button');apply.id='save-level-'+c.id;apply.textContent='保存等级';apply.onclick=()=>input.onchange();card.append(apply);
  const state=document.createElement('span');state.className='tag';state.textContent='已解锁 · 首场样片以完整动作目录为准';card.append(state);el('roster').append(card);
 }
}
function svg(tag,attributes,text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attributes))n.setAttribute(k,v);if(text)n.textContent=text;el('map-view').append(n);return n;}
function drawMap(task){
 const raw=task.tiles.map(t=>({tile:t,x:Math.sqrt(3)*(t.Location.x+t.Location.z/2),y:1.5*t.Location.z}));
 const min=Math.min(...raw.map(p=>p.x)),max=Math.max(...raw.map(p=>p.x)),scale=330/Math.max(1,max-min);
 for(const p of raw){const x=105+(p.x-min)*scale,y=80+p.y*scale;const points=Array.from({length:6},(_,i)=>{const a=Math.PI/3*i+Math.PI/6;return [x+48*Math.cos(a),y+48*Math.sin(a)].join(',');}).join(' ');
  const encounter=task.encounters.find(e=>JSON.stringify(e.position)===JSON.stringify(p.tile.Location));
  svg('polygon',{points,fill:encounter?'#cae5f2':'#ddeada',stroke:'#7aa4ba','stroke-width':2});
  const label=encounter?'遭遇 '+(task.encounters.indexOf(encounter)+1):'地图机关';svg('text',{x,y:y+5,'text-anchor':'middle',fill:'#254e69','font-size':14},label);
  svg('text',{x,y:y+75,'text-anchor':'middle',fill:'#627e90','font-size':11},`${p.tile.Location.x}, ${p.tile.Location.y}, ${p.tile.Location.z}`);
 }
}
function tab(name){for(const id of ['task','roster']){el(id+'-panel').hidden=id!==name;el(id+'-tab').setAttribute('aria-selected',String(id===name));}}
el('task-tab').onclick=()=>tab('task');el('roster-tab').onclick=()=>tab('roster');el('roster-search').oninput=()=>data&&students();
el('batch-apply').onclick=()=>{if(!data)return;try{const level=parseLevel(el('batch-level').value,data.levelRange);const next={version:1,levels:Object.fromEntries(data.characters.map(c=>[c.id,level]))};if(save(next))students();}catch(e){report(e.message);}};
async function start(){try{const r=await fetch('/app/bats-data.json');if(!r.ok)throw Error('本地任务目录缺失');data=await r.json();config=loadConfig(localStorage.getItem(KEY),data.characters,data.levelRange);el('roster-count').textContent=`已关联 ${data.characters.length} 个角色条目，全部默认解锁。等级 ${data.levelRange.min}–${data.levelRange.max}，以本地版本为准。`;el('batch-level').min=data.levelRange.min;el('batch-level').max=data.levelRange.max;el('task-status').textContent=data.task.status;
 const auditResponse=await fetch('/app/battle-input-catalog.json');if(!auditResponse.ok)throw Error('本地战斗输入目录缺失');const audit=await auditResponse.json();if(audit.schemaVersion!==1||audit.taskId!==data.task.id)throw Error('战斗输入与当前任务版本不匹配');
 for(const [i,e] of data.task.encounters.entries()){const row=document.createElement('div');row.className='encounter';const title=document.createElement('strong');title.textContent='遭遇 '+(i+1);const p=document.createElement('p');p.className='muted';p.textContent=e.scene+' · ID '+e.id;row.append(title,p);const input=audit.inputs.find(v=>v.encounterId===e.id);if(input){const state=document.createElement('p');state.textContent=i===0?'首场可进入 COST / EX 战斗样片。':'事件引用与出生记录已读出；第二场实战待接入。';row.append(state);}const link=document.createElement('a');link.className='button';link.href='encounter.html?id='+e.id;link.textContent='查看出生与事件配置';row.append(link);if(i===0){const play=document.createElement('a');play.className='button';play.href='battle.html';play.textContent='进入首场战斗样片';row.append(play);}el('encounters').append(row);}drawMap(data.task);students();if(Object.keys(config.levels).length)report('已恢复本地角色等级配置');console.log('BATS_TASK_READY '+JSON.stringify({id:data.task.id,tiles:data.task.tiles.length,encounters:data.task.encounters.length,characters:data.characters.length}));
}catch(e){report(e.message);console.error('BATS_TASK_ERROR '+e.message);}}
start();
