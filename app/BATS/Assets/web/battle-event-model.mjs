// Read-only battle configuration. This module does not execute event commands.
export function validateEventCatalog(data){
 if(data?.schemaVersion!==1||data.taskId!==1011101||data.readyToPlay!==false||!Array.isArray(data.encounters)||data.encounters.length!==2)throw Error('关卡配置版本不匹配');
 const ids=new Set(data.enemies?.map(e=>e.id));
 if(ids.size!==3||data.enemies.some(e=>!Number.isSafeInteger(e.id)||typeof e.code!=='string'||e.statFieldCount!==84||e.statFields.length!==84||e.statSemanticsConfirmed!==false))throw Error('敌方目录不完整');
 const codes=new Set(data.enemies.map(e=>e.code));
 for(const e of data.encounters){
  if(![101110101,101110102].includes(e.id)||e.readyToPlay!==false||!Array.isArray(e.waves)||e.waves.length!==3||!/^[a-f0-9]{64}$/.test(e.source?.payloadSHA256||''))throw Error('遭遇配置不完整');
  for(const wave of e.waves){
   if(wave.primaryRecords!==wave.spawns.length||wave.nestedRecords!==wave.spawns.reduce((n,s)=>n+s.nestedPlacements.length,0)||!wave.triggerEvents.length)throw Error('出生引用不一致');
   for(const s of wave.spawns){if(!codes.has(s.code)||s.positionRaw.length!==3||!s.positionRaw.every(Number.isFinite))throw Error('出生位置或单位引用无效');}
  }
 }
 if(new Set(data.encounters.map(e=>e.id)).size!==2)throw Error('遭遇 ID 重复');
 return data;
}
export function positionsFor(encounter,commandRef='all'){
 return encounter.waves.filter(w=>commandRef==='all'||w.commandRef===commandRef).flatMap(w=>w.spawns.map(s=>({...s,commandRef:w.commandRef})));
}
export function deathReferences(event){return event.conditions.filter(c=>c.tag===9).map(c=>c.fields[0]);}
export function shortEnemy(code){return code.endsWith('_MG_C')?'机枪单位 C':code.includes('_SMG_')?'冲锋枪杂兵':'机枪杂兵';}
