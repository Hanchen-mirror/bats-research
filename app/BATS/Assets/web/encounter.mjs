import {validateEventCatalog,positionsFor,deathReferences,shortEnemy} from './battle-event-model.mjs';
const el=id=>document.getElementById(id),params=new URLSearchParams(location.search);
let catalog,encounter,selected='all';
const colors={'SchoolGirl_Sukeban_SMG_M':'#247ab0','SchoolGirl_Sukeban_MG_M':'#a35b21','SchoolGirl_Sukeban_MG_C':'#b52e61'};
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function shape(tag,attrs,text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;el('spawn-map').append(n);return n;}
function draw(){
 const points=positionsFor(encounter,selected),all=positionsFor(encounter),nested=points.flatMap(p=>p.nestedPlacements);
 const maxZ=Math.max(40,...all.map(p=>p.positionRaw[2]),...encounter.areas.map(a=>a.position[2]))+3,maxX=Math.max(5,...all.map(p=>Math.abs(p.positionRaw[1])),...all.flatMap(p=>p.nestedPlacements.map(n=>Math.abs(n.positionRaw[1]))));
 const xy=v=>[310+v[1]*230/maxX,385-v[2]*340/maxZ];
 el('spawn-map').replaceChildren();
 for(let z=0;z<=maxZ;z+=10){const y=xy([0,0,z])[1];shape('line',{x1:50,x2:570,y1:y,y2:y,stroke:'#ccdee9'});shape('text',{x:24,y:y+4,fill:'#627e91','font-size':11},String(z));}
 shape('line',{x1:310,x2:310,y1:35,y2:385,stroke:'#b4cedd','stroke-dasharray':'5 5'});
 shape('text',{x:310,y:414,'text-anchor':'middle',fill:'#627e91','font-size':11},'出生位置示意 · 坐标轴映射待核对');
 for(const a of encounter.areas){const [x,y]=xy(a.position);shape('text',{x:580,y,'text-anchor':'end',fill:'#8a9eaa','font-size':10},a.name);}
 for(const [i,p] of points.entries()){
  const [x,y]=xy(p.positionRaw),circle=shape('circle',{cx:x,cy:y,r:9,fill:colors[p.code]});
  const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=shortEnemy(p.code)+' · '+p.commandRef;circle.append(title);
  shape('text',{x:x+12,y:y+4,fill:colors[p.code],'font-size':11},String(i+1));
  for(const n of p.nestedPlacements){const [nx,ny]=xy(n.positionRaw);shape('line',{x1:x,y1:y,x2:nx,y2:ny,stroke:colors[p.code],'stroke-dasharray':'3 3'});shape('circle',{cx:nx,cy:ny,r:6,fill:'none',stroke:colors[p.code],'stroke-width':2});}
 }
 el('map-note').textContent=`显示 ${points.length} 条主出生记录、${nested.length} 条嵌套位置（空心点，含义待核对）。图中编号对应下方记录。`;
 el('spawn-list').replaceChildren();
 for(const [i,p] of points.entries()){
  const e=catalog.enemies.find(e=>e.code===p.code),card=node('article',undefined,'spawn');card.append(node('strong',`${i+1}. ${shortEnemy(p.code)}`));card.append(node('p',`${p.code} · ID ${e.id}`));card.append(node('p',`来源：第 ${p.sectionId} 段 · ${p.commandRef}`));card.append(node('p',`关联死亡组：${p.conditionRefs.join('、')||'无'}`));if(p.nestedPlacements.length)card.append(node('small',`另有 ${p.nestedPlacements.length} 条嵌套位置，尚未确定生成规则`));el('spawn-list').append(card);
 }
 for(const b of el('wave-picker').children)b.setAttribute('aria-pressed',String(b.dataset.ref===selected));
 console.log('BATS_EVENT_VIEW '+JSON.stringify({id:encounter.id,selected,primary:points.length,nested:nested.length}));
}
function render(){
 selected='all';encounter=catalog.encounters.find(e=>String(e.id)===el('encounter-picker').value);if(!encounter)throw Error('遭遇 ID 不存在');
 const primary=encounter.waves.reduce((n,w)=>n+w.primaryRecords,0),nested=encounter.waves.reduce((n,w)=>n+w.nestedRecords,0);
 el('encounter-title').textContent='普通 1-1 · '+(encounter.id===101110101?'遭遇 1':'遭遇 2 · Boss');
 el('encounter-summary').textContent=`${encounter.waves.length} 组刷怪命令 · ${primary} 条主记录 · ${nested} 条嵌套位置 · ${encounter.events.length} 个事件`;
 el('event-status').textContent='本地配置已载入 · 尚未开放战斗';el('wave-picker').replaceChildren();
 for(const [ref,title] of [['all','全部出生记录'],...encounter.waves.map((w,i)=>[w.commandRef,`命令组 ${i+1} · ${w.primaryRecords} 条记录`])]){const b=node('button',title);b.dataset.ref=ref;b.onclick=()=>{selected=ref;draw();};el('wave-picker').append(b);}
 el('enemy-legend').replaceChildren();for(const e of catalog.enemies.filter(e=>positionsFor(encounter).some(p=>p.code===e.code)))el('enemy-legend').append(node('span',`${shortEnemy(e.code)} · ID ${e.id}`));
 el('end-refs').textContent=deathReferences(encounter.endEvent).join(' + ');
 el('event-list').replaceChildren();
 for(const ev of encounter.events){const refs=deathReferences(ev),cmds=ev.commands.map(c=>c.tag===51?c.fields[0]:c.tag===54?`${c.fields[3]} → ${c.fields[2]?'开启':'关闭'}`:c.tag===53?`段编号 ${c.fields[2]}`:c.tag===19?'结束命令（判定待还原）':`命令类型 ${c.tag}`);el('event-list').append(node('p',`${ev.name} ｜ 条件引用：${refs.join('、')||'其他/无'} ｜ ${cmds.join('；')}`));}
 const empty=encounter.sections.filter(s=>s.primaryRecords===0).map(s=>s.id);el('empty-sections').textContent=empty.length?`原文件中第 ${empty.join('、')} 段没有主出生记录，保留其模板配置。`:'各分段均包含主出生记录。';
 el('unresolved').textContent=encounter.unresolvedDeathRefs.length?'尚无出生记录关联的死亡组：'+encounter.unresolvedDeathRefs.join('、'):'本文件涉及的死亡组均能关联到主出生记录。';
 el('event-source').textContent=`${encounter.source.entry} · ${encounter.source.bytes} 字节 · SHA-256 ${encounter.source.payloadSHA256}`;
 el('opaque-fields').textContent='保留原始字节、尚待解释：根配置前缀、范围条件尾部、场景动画命令参数、标记对象字段。敌方属性表已关联；84 个字段的含义与等级换算尚未确定。';draw();
}
el('encounter-picker').onchange=()=>{try{render();}catch(e){el('event-status').textContent=e.message;console.error('BATS_EVENT_ERROR '+e.message);}};
async function start(){try{const r=await fetch('/app/battle-event-catalog.json');if(!r.ok)throw Error('本地战斗配置缺失');catalog=validateEventCatalog(await r.json());const id=params.get('id');if(catalog.encounters.some(e=>String(e.id)===id))el('encounter-picker').value=id;render();document.body.dataset.ready='true';}catch(e){el('event-status').textContent=e.message;console.error('BATS_EVENT_ERROR '+e.message);}}
start();
