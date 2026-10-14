export function parseLevel(value,range){
 const text=String(value).trim();if(!/^\d+$/.test(text))throw Error('请输入整数等级');
 const level=Number(text);if(!Number.isSafeInteger(level)||level<range.min||level>range.max)throw Error(`等级范围为 ${range.min}–${range.max}`);
 return level;
}
export function loadConfig(raw,characters,range){
 let source;try{source=JSON.parse(raw);}catch{source=null;}
 const allowed=new Set(characters.map(c=>String(c.id))),levels={};
 if(source?.version===1&&source.levels&&typeof source.levels==='object')for(const [id,value] of Object.entries(source.levels)){
  if(!allowed.has(id))continue;try{levels[id]=parseLevel(value,range);}catch{}
 }
 return {version:1,levels};
}
export function levelFor(config,id,range){return config.levels[id]??range.min;}
export function setLevel(config,id,value,characters,range){
 if(!characters.some(c=>String(c.id)===String(id)))throw Error('未识别的角色');
 return {...config,levels:{...config.levels,[id]:parseLevel(value,range)}};
}
