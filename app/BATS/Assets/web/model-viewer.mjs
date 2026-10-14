import {loadAnimation} from './model-animation-controls.mjs';
import {modelPartKind,animationFit} from './model-layout.mjs';
const canvas=document.getElementById('model-canvas'),status=document.getElementById('model-status');
const gl=canvas.getContext('webgl',{alpha:false,antialias:true});
let parts=[],yaw=0,pitch=0,zoom=1,drag=null,ready=false,lost=false,hostPaused=false,last=0;
window.hallHostPause=value=>hostPaused=value;
const params=new URLSearchParams(location.search);
let base,selected,students=[],filtered=[];
const picker=document.getElementById('model-picker'),search=document.getElementById('model-search'),onlyReady=document.getElementById('model-ready-only');
search.value=params.get('q')||'';onlyReady.checked=params.get('all')!=='1';
function navigate(row){if(!row)return;const p=new URLSearchParams({student:String(row.id)});if(search.value)p.set('q',search.value);if(!onlyReady.checked)p.set('all','1');location.href='models.html?'+p;}
function filterStudents(){
 const q=search.value.trim().toLowerCase();filtered=students.filter(r=>(!onlyReady.checked||(r.status==='ready'&&r.kind!=='placeholder'))&&[r.name,r.modelKey,r.code,String(r.id)].some(v=>v.toLowerCase().includes(q)));
 picker.replaceChildren();for(const row of filtered){const option=new Option(row.name+' · '+row.modelKey+(row.kind==='placeholder'?' · 占位记录':row.status==='ready'?'':' · 待补齐'),String(row.id));picker.add(option);}picker.value=String(selected?.id);
 const i=filtered.findIndex(r=>r.id===selected?.id);document.getElementById('model-prev').disabled=i<=0;document.getElementById('model-next').disabled=i<0||i>=filtered.length-1;
 document.getElementById('model-count').textContent=`显示 ${filtered.length} / ${students.length} 个学生与形态条目 · ${students.filter(r=>r.status==='ready'&&r.kind!=='placeholder').length} 个学生形态可预览`;
}
search.oninput=filterStudents;onlyReady.onchange=filterStudents;picker.onchange=()=>navigate(students.find(r=>String(r.id)===picker.value));
document.getElementById('model-prev').onclick=()=>navigate(filtered[filtered.findIndex(r=>r.id===selected?.id)-1]);document.getElementById('model-next').onclick=()=>navigate(filtered[filtered.findIndex(r=>r.id===selected?.id)+1]);
async function init(){try{
 const response=await fetch('/app/model-catalog.json');if(!response.ok)throw Error('模型目录缺失');const catalog=await response.json();students=catalog.students;
 selected=students.find(r=>String(r.id)===params.get('student'))||students.find(r=>r.status==='ready');if(!selected)throw Error('模型目录中尚无可预览条目');
 document.getElementById('model-title').textContent=selected.name;document.getElementById('model-code').textContent=selected.code+' · ID '+selected.id;document.getElementById('model-notes').textContent=(selected.warnings||[]).join('；')||'模型资源已关联，画面细节仍需逐步核查。';filterStudents();
 if(selected.status!=='ready'){status.textContent='暂不可预览：'+selected.reason;return;}
 base='/app/student-models/'+selected.modelKey+'/';await start();
 }catch(e){status.textContent=e.message;console.error('BATS_MODEL_ERROR '+e.message);}}
async function fetchOK(path){const r=await fetch(base+path);if(!r.ok)throw Error('模型资源缺失：'+path);return r;}
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
let program,uniforms,modelData,animation=null,animationActive=false;const textures=new Map();
// Preview layout transforms stay separate from the exported source vertices.
function layout(){
 const separate=!animationActive&&document.getElementById('model-separated').checked;
 for(const p of parts){const kind=modelPartKind(p,selected.modelKey),equipment=kind==='equipment';p.visible=(kind!=='prop'||document.getElementById('model-props').checked)&&((animationActive?p.animationEligible&&p.animationEnvelopeVisible:p.sourceActive!==false||equipment)||document.getElementById('model-hidden').checked);p.offset=[0,0,0];}
 if(!parts.some(p=>p.visible)){for(const p of parts)p.visible=p.sourceActive!==false;}
 const visible=parts.filter(p=>p.visible);
 const groups=new Map();for(const p of visible){if(!groups.has(p.group||p.mesh))groups.set(p.group||p.mesh,[]);groups.get(p.group||p.mesh).push(p);}
 const boxes=[...groups.entries()].map(([name,list])=>({name,list,accessory:/weapon|shield/i.test(name),lo:[0,1,2].map(i=>Math.min(...list.map(p=>p.bounds.min[i]))),hi:[0,1,2].map(i=>Math.max(...list.map(p=>p.bounds.max[i])))}));
 let edge=Math.max(...boxes.filter(b=>!b.accessory).map(b=>b.hi[0]));if(!Number.isFinite(edge))edge=0;
 for(const b of boxes){let offset=[0,0,0];if(separate&&b.accessory){offset=[edge+.12-b.lo[0],0,-(b.lo[2]+b.hi[2])/2];edge=b.hi[0]+offset[0];}for(const p of b.list)p.offset=offset;}
 const lo=[0,1,2].map(i=>Math.min(...visible.map(p=>p.bounds.min[i]+p.offset[i]))),hi=[0,1,2].map(i=>Math.max(...visible.map(p=>p.bounds.max[i]+p.offset[i])));
 modelData={lo,hi};gl.useProgram(program);gl.uniform3fv(uniforms.center,lo.map((n,i)=>(n+hi[i])/2));gl.uniform1f(uniforms.height,hi[1]-lo[1]);
}
async function loadTexture(path){
 if(textures.has(path))return textures.get(path);
 const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('模型贴图读取失败：'+path));image.src=base+path;});
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);textures.set(path,texture);return texture;
}
function animationFallback(e){
 animation=null;animationActive=false;for(const p of parts){gl.bindBuffer(gl.ARRAY_BUFFER,p.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,p.originalValues);}document.getElementById('model-separated').disabled=false;
 for(const id of ['animation-picker','animation-play','animation-seek','animation-speed','animation-loop'])document.getElementById(id).disabled=true;layout();document.getElementById('animation-status').textContent='动作读取失败，已恢复静态姿态。';console.error('BATS_ANIMATION_ERROR '+e.message);
}
async function start(){try{
 if(!gl)throw Error('此设备无法创建 WebGL 上下文');
 program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec3 a_position;attribute vec2 a_uv;uniform vec3 u_center,u_offset;uniform float u_height,u_yaw,u_pitch,u_zoom,u_aspect;varying vec2 v_uv;void main(){vec3 p=(a_position+u_offset-u_center)/u_height;float c=cos(u_yaw),s=sin(u_yaw);p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);c=cos(u_pitch);s=sin(u_pitch);p=vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);float d=2.4-p.z;gl_Position=vec4(-p.x*3.5*u_zoom/u_aspect,p.y*3.5*u_zoom,-p.z*.5,d);v_uv=a_uv;}`));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`precision mediump float;uniform sampler2D u_texture,u_mouth;uniform bool u_hasMouth;uniform int u_alphaMode;uniform float u_cutoff;uniform vec4 u_mouthST,u_textureST,u_eyeTint,u_mouthTint;varying vec2 v_uv;void main(){vec4 c=texture2D(u_texture,v_uv*u_textureST.xy+u_textureST.zw);if(u_hasMouth){if(v_uv.x<=.25&&v_uv.y<=.25)c=texture2D(u_mouth,v_uv*u_mouthST.xy+u_mouthST.zw)*u_mouthTint;else c*=u_eyeTint;}else if(u_alphaMode==0)c.a=1.0;if((u_hasMouth&&c.a<.02)||(u_alphaMode==1&&c.a<u_cutoff))discard;gl_FragColor=c;}`));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 uniforms=Object.fromEntries(['center','offset','height','yaw','pitch','zoom','aspect','texture','mouth','hasMouth','mouthST','eyeTint','mouthTint','textureST','alphaMode','cutoff'].map(n=>[n,gl.getUniformLocation(program,'u_'+n)]));
 const data=await (await fetchOK('model.json')).json(),lo=data.bounds.min,hi=data.bounds.max;
 gl.uniform3fv(uniforms.center,lo.map((n,i)=>(n+hi[i])/2));gl.uniform1f(uniforms.height,hi[1]-lo[1]);gl.uniform1i(uniforms.texture,0);
 gl.uniform1i(uniforms.mouth,1);
 for(const part of data.parts){
  const bytes=await (await fetchOK(part.buffer)).arrayBuffer();if(bytes.byteLength!==part.vertices*20)throw Error('模型顶点长度不匹配');
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,bytes,gl.DYNAMIC_DRAW);
  const texture=await loadTexture(part.texture),mouth=part.mouthTexture?await loadTexture(part.mouthTexture):null;
  const values=new Float32Array(bytes),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let n=0;n<values.length;n+=5)for(let i=0;i<3;i++){min[i]=Math.min(min[i],values[n+i]);max[i]=Math.max(max[i],values[n+i]);}
  parts.push({...part,buffer,texture,mouth,bounds:{min,max},originalBounds:{min,max},originalValues:values});
 }
 gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);layout();ready=true;
 status.dataset.ready='true';status.textContent='模型已载入 · '+parts.length+' 个材质分组\n拖动可检查正面、侧面与背面。';console.log('BATS_MODEL_LOADED '+JSON.stringify({id:data.id,parts:parts.length,vertices:parts.reduce((n,p)=>n+p.vertices,0)}));
 try{animation=await loadAnimation(selected.modelKey,fetchOK,parts,gl,active=>{animationActive=active;document.getElementById('model-separated').disabled=active;layout();});}catch(e){animationFallback(e);}
 status.dataset.animationReady='true';
 requestAnimationFrame(frame);
}catch(e){status.textContent=e.message;console.error('BATS_MODEL_ERROR '+e.message);}}
function frame(now){
 if(lost)return;const dt=last?Math.min((now-last)/1000,.05):0;last=now;
 if(ready&&!document.hidden&&!hostPaused){
  try{animation?.step(dt);}catch(e){animationFallback(e);}
  if(document.getElementById('model-spin').checked)yaw+=dt*.35;
  const r=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(canvas.clientWidth*r)),h=Math.max(1,Math.round(canvas.clientHeight*r));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  gl.viewport(0,0,w,h);gl.clearColor(.82,.89,.94,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
  const fit=animationActive?animationFit(modelData.lo,modelData.hi,yaw,pitch,w/h):Math.min(1,(w/h)*(modelData.hi[1]-modelData.lo[1])/(modelData.hi[0]-modelData.lo[0]));
  gl.uniform1f(uniforms.yaw,yaw);gl.uniform1f(uniforms.pitch,pitch);gl.uniform1f(uniforms.zoom,zoom*fit);gl.uniform1f(uniforms.aspect,w/h);
  const position=gl.getAttribLocation(program,'a_position'),uv=gl.getAttribLocation(program,'a_uv');gl.enableVertexAttribArray(position);gl.enableVertexAttribArray(uv);
  for(const p of parts){if(!p.visible||(animationActive&&!p.animationVisible&&!document.getElementById('model-hidden').checked))continue;gl.uniform3fv(uniforms.offset,p.offset);gl.bindBuffer(gl.ARRAY_BUFFER,p.buffer);gl.vertexAttribPointer(position,3,gl.FLOAT,false,20,0);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,20,12);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,p.texture);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,p.mouth||p.texture);gl.uniform1i(uniforms.hasMouth,p.mouth?1:0);gl.uniform1i(uniforms.alphaMode,p.alphaMode==='blend'?2:p.alphaMode==='mask'?1:0);gl.uniform1f(uniforms.cutoff,p.alphaCutoff??.5);gl.uniform4fv(uniforms.textureST,p.textureST||[1,1,0,0]);gl.uniform4fv(uniforms.mouthST,p.mouthST||[1,1,0,0]);gl.uniform4fv(uniforms.eyeTint,p.eyeTint||[1,1,1,1]);gl.uniform4fv(uniforms.mouthTint,p.mouthTint||[1,1,1,1]);gl.drawArrays(gl.TRIANGLES,0,p.vertices);}
 }
 requestAnimationFrame(frame);
}
canvas.onpointerdown=e=>{if(!drag){drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}};
canvas.onpointermove=e=>{if(drag?.id===e.pointerId){yaw-=(e.clientX-drag.x)*.01;pitch=Math.max(-1,Math.min(1,pitch+(e.clientY-drag.y)*.01));drag={id:e.pointerId,x:e.clientX,y:e.clientY};}};
canvas.onpointerup=canvas.onpointercancel=()=>drag=null;
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.5,Math.min(2,zoom*Math.exp(-e.deltaY*.001)));document.getElementById('model-zoom').value=zoom;},{passive:false});
document.getElementById('model-zoom').oninput=e=>zoom=Number(e.target.value);
document.getElementById('model-separated').onchange=()=>ready&&layout();
document.getElementById('model-hidden').onchange=()=>ready&&layout();
document.getElementById('model-props').onchange=()=>ready&&layout();
document.getElementById('model-reset').onclick=()=>{yaw=0;pitch=0;zoom=1;document.getElementById('model-zoom').value=1;};
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;status.textContent='画面资源被系统回收，等待恢复…';});canvas.addEventListener('webglcontextrestored',()=>location.reload());
window.addEventListener('pagehide',()=>{if(gl&&!lost){for(const p of parts)gl.deleteBuffer(p.buffer);for(const t of textures.values())gl.deleteTexture(t);gl.deleteProgram(program);}lost=true;});
init();
