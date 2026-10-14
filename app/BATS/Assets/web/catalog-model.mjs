export const kindLabel = kind => ({normal_candidate:'普通立绘', memory_candidate:'记忆大厅', background_candidate:'背景'})[kind] || '其他';

export function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !/[\\?#:%\u0000-\u001f]/.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..');
}

export function prepareCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.scenes) || catalog.scenes.length > 10000)
    throw Error('资源目录格式不支持，请使用本项目生成的 catalog.json。');
  const ids = new Set(), groups = new Map(), entries = [], failures = [];
  for (const original of catalog.scenes) {
    if (!original || typeof original.id !== 'string' || ids.has(original.id)) throw Error('目录存在无效或重复的场景标识。');
    ids.add(original.id);
    const scene = {...original};
    let error = scene.parserStatus === 'passed' ? '' : (scene.error || '未通过解析');
    if (!error && (!safePath(scene.skeleton) || !safePath(scene.atlas) || !Array.isArray(scene.pages)
      || !scene.pages.length || scene.pages.some(p => !safePath(p.path) || typeof p.atlas_name !== 'string')))
      error = '资源路径或图集依赖无效';
    if (!error && !/^4\.2\./.test(scene.version || '')) error = '当前播放器只支持 Spine 4.2 资源';
    if (error) { failures.push({id:scene.id, error}); continue; }
    scene.animations = Array.isArray(scene.animations) ? scene.animations : [];
    // Derive conservatively even when importing a catalog made by the old rule.
    const key = String(scene.sourceKey || '').toLowerCase();
    const role = scene.kind === 'normal_candidate' ? key.replace(/_spr$/, '')
      : scene.kind === 'memory_candidate' ? key.replace(/_(home|multi)$/, '') : null;
    scene.groupKey = role && role !== '_mxcommon' ? 'candidate:' + role : 'resource:' + scene.visualId;
    scene.groupLabel = role && role !== '_mxcommon' ? role : (scene.sourceKey || scene.id);
    scene.candidate = scene.groupKey.startsWith('candidate:');
    const basename = scene.skeleton.split('/').pop().replace(/\.skel$/i,'');
    scene.componentCandidate = scene.kind === 'memory_candidate' && !/_home$/i.test(basename);
    entries.push(scene);
    if (!groups.has(scene.groupKey)) groups.set(scene.groupKey, {key:scene.groupKey,label:scene.groupLabel,candidate:scene.candidate,scenes:[]});
    groups.get(scene.groupKey).scenes.push(scene);
  }
  const sorted = [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
  return {entries,groups:sorted,failures,total:catalog.scenes.length};
}

export function filterGroups(groups, mode, query, favorites, onlyFavorites) {
  const q = query.trim().toLowerCase();
  return groups.map(group => ({...group, visible:group.scenes.filter(scene =>
    (mode === 'all' || scene.kind === mode) && (!onlyFavorites || favorites.has(scene.id)) &&
    (!q || [group.label,group.identity?.characterId,scene.sourceKey,scene.id,scene.label].some(x=>String(x || '').toLowerCase().includes(q))))}))
    .filter(group => group.visible.length);
}

export function annotateGroups(groups,links){
  if(links?.schemaVersion!==1||!links.groups)return 0;
  let count=0;
  for(const group of groups){
    const identity=links.groups[group.key];
    if(!identity||!Number.isSafeInteger(identity.characterId)||identity.characterId<=0||!['prefab-checked','table-linked-candidate'].includes(identity.status))continue;
    // Never move scenes between groups based on a display name or inferred schema.
    group.identity=identity;
    group.label=identity.displayName?identity.displayName+' · '+identity.resourceKey:identity.resourceKey;
    for(const scene of group.scenes){scene.groupLabel=group.label;scene.identity=identity;}
    count++;
  }
  return count;
}

export function pickScene(group, mode, previousId) {
  const matches = group.scenes.filter(s=>mode === 'all' || s.kind === mode);
  return group.scenes.find(s=>s.id === previousId && (mode === 'all' || s.kind === mode))
    || matches.find(s=>!s.componentCandidate) || matches[0] || group.scenes[0];
}
