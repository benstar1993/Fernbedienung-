#pragma once
#include <Arduino.h>

// Web-Oberflaeche (wird vom StickS3 ausgeliefert, funktioniert ohne Internet)
static const char INDEX_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEC IR-Fernbedienung</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--fg:#1c1f24;--mut:#6b7280;--line:#e2e5ea;--acc:#1f6feb;--ok:#1a7f37;--warn:#b54708;--bad:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--card:#1a1e24;--fg:#e6e8eb;--mut:#9aa3ad;--line:#2b313a;--acc:#4c8dff;--ok:#3fb950;--warn:#e3a008;--bad:#f06363}}
*{box-sizing:border-box}body{margin:0;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px}
h1{font-size:17px;margin:0}nav{display:flex;gap:6px;margin-top:8px}
nav button{flex:1;padding:8px 4px;font-size:13px}main{max-width:820px;margin:0 auto;padding:12px 16px 80px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:8px 12px;cursor:pointer}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff}button.dan{color:var(--bad)}
button.on{background:var(--acc);color:#fff;border-color:var(--acc)}button:disabled{opacity:.5}
button.sm{padding:4px 8px;font-size:13px}
input,select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;min-width:0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grow{flex:1}
.mut{color:var(--mut);font-size:13px}.ok{color:var(--ok)}.warn{color:var(--warn)}
.macro-btn{display:block;width:100%;text-align:left;padding:14px;font-size:16px;margin-bottom:8px}
.status{border-left:4px solid var(--acc)}
.step{display:grid;grid-template-columns:minmax(0,1fr) 48px 68px auto;gap:6px;align-items:center;margin:4px 0}
.step .ctl{display:flex;gap:2px}
table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:middle}
td.act{text-align:right;white-space:nowrap}
#toast{position:fixed;left:16px;right:16px;bottom:16px;max-width:600px;margin:auto;padding:10px 14px;border-radius:8px;background:var(--fg);color:var(--bg);display:none}
.hide{display:none}
</style></head><body>
<header><h1>NEC M431 &ndash; IR-Fernbedienung</h1>
<nav><button data-tab="run" class="on">Makros</button><button data-tab="edit">Makros bearbeiten</button><button data-tab="keys">Tasten</button><button data-tab="set">Einstellungen</button></nav></header>
<main>
<div id="status" class="card status hide"></div>

<section id="tab-run">
 <div id="runlist"></div>
 <p class="mut">Makros laufen auf dem StickS3. Den StickS3 mit der IR-LED (Oberseite) auf den Empfaenger des Displays richten.</p>
</section>

<section id="tab-edit" class="hide">
 <div id="macroedit"></div>
 <div class="row"><button onclick="addMacro()">+ Makro</button><span class="grow"></span><button class="pri" onclick="saveMacros()">Makros speichern</button></div>
</section>

<section id="tab-keys" class="hide">
 <div class="card"><b>Tasten anlernen:</b> &bdquo;Lernen&ldquo; antippen, dann die Original-NEC-Fernbedienung aus ca. 30&nbsp;cm auf die Oberseite des StickS3 richten und die Taste kurz druecken.
 Alternativ NEC-Adresse/Befehl (hex) direkt eintragen.</div>
 <div class="card"><table id="keytable"></table>
 <div class="row" style="margin-top:10px"><button onclick="addKey()">+ Taste</button><span class="grow"></span><button class="pri" onclick="saveKeys()">Tasten speichern</button></div></div>
</section>

<section id="tab-set" class="hide">
 <div class="card"><b>WLAN</b>
  <p class="mut" id="wifiinfo"></p>
  <div class="row"><label class="grow">Access-Point-Name<br><input id="ap_ssid" style="width:100%"></label>
  <label class="grow">AP-Passwort (min. 8)<br><input id="ap_pass" type="password" placeholder="unveraendert" style="width:100%"></label></div>
  <div class="row" style="margin-top:8px"><label class="grow">Vorhandenes WLAN (optional)<br><input id="sta_ssid" style="width:100%"></label>
  <label class="grow">WLAN-Passwort<br><input id="sta_pass" type="password" placeholder="unveraendert" style="width:100%"></label></div>
  <div class="row" style="margin-top:10px"><button class="pri" onclick="saveSettings()">Speichern &amp; neu starten</button></div>
 </div>
 <div class="card"><b>Firmware-Update (OTA)</b>
  <p class="mut">Installiert: <span id="fwver">?</span>. Neue <code>firmware.bin</code> auswaehlen (Arduino IDE: <i>Sketch &rarr; Kompilierte Binaerdatei exportieren</i>).</p>
  <div class="row"><input type="file" id="fwfile" accept=".bin" class="grow"><button class="pri" id="fwbtn" onclick="uploadFw()">Update starten</button></div>
  <progress id="fwprog" max="100" value="0" class="hide" style="width:100%;margin-top:8px"></progress>
 </div>
 <div class="card"><b>Sicherung</b><p class="mut">Tasten und Makros als Datei sichern bzw. auf weitere StickS3 uebertragen.</p>
  <div class="row"><a href="/api/backup"><button>Backup herunterladen</button></a>
  <label><button onclick="document.getElementById('restore').click()">Backup einspielen</button></label>
  <input type="file" id="restore" accept=".json,application/json" class="hide" onchange="restore(this)">
  <span class="grow"></span><button class="dan" onclick="resetAll()">Werkseinstellungen</button></div>
 </div>
</section>
</main>
<div id="toast"></div>
<script>
let keys=[],macros=[],state={},lastLearn='',tab='run';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hex=(n,w)=>n.toString(16).toUpperCase().padStart(w,'0');
function toast(m,err){const t=$('#toast');t.textContent=m;t.style.background=err?'var(--bad)':'';t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',3500)}
async function api(path,body){
 const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({ok:false,error:'Keine Antwort'}));
 if(j.ok===false){toast(j.error||'Fehler',true);throw new Error(j.error)}return j}
function codeText(k){if(k.proto==='nec')return 'NEC '+hex(k.addr,4)+':'+hex(k.cmd,2);if(k.proto==='raw')return 'RAW ('+k.raw.length+')';return '<span class="warn">nicht angelernt</span>'}

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;
 document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));
 document.querySelectorAll('main section').forEach(s=>s.classList.toggle('hide',s.id!=='tab-'+tab));
 if(tab==='run')renderRun();});

function renderRun(){
 $('#runlist').innerHTML=macros.map((m,i)=>{
  const missing=m.steps.filter(s=>s.key&&!(keys.find(k=>k.id===s.key)||{}).proto).map(s=>s.key);
  return `<button class="macro-btn card" onclick="runMacro(${i})"><b>${esc(m.name)}</b><br><span class="mut">${m.steps.length} Schritte${missing.length?' &middot; <span class="warn">nicht angelernt: '+esc([...new Set(missing)].join(', '))+'</span>':''}</span></button>`}).join('')||'<p class="mut">Noch keine Makros.</p>'}
async function runMacro(i){await api('/api/run',{index:i});poll()}
async function stopMacro(){await api('/api/stop',{})}

function keyOptions(sel){return '<option value="">&#9201; Warten</option>'+keys.map(k=>`<option value="${esc(k.id)}"${k.id===sel?' selected':''}>${esc(k.label)}</option>`).join('')}
function renderEdit(){
 $('#macroedit').innerHTML=macros.map((m,i)=>`<div class="card">
  <div class="row"><input class="grow" value="${esc(m.name)}" oninput="macros[${i}].name=this.value">
  <button class="sm" onclick="mv(macros,${i},-1);renderEdit()">&uarr;</button><button class="sm" onclick="mv(macros,${i},1);renderEdit()">&darr;</button>
  <button class="sm dan" onclick="if(confirm('Makro loeschen?')){macros.splice(${i},1);renderEdit()}">Loeschen</button></div>
  <div class="mut" style="margin-top:8px;display:grid;grid-template-columns:minmax(0,1fr) 48px 68px auto;gap:6px"><span>Taste / Aktion</span><span>Anzahl</span><span>Pause ms</span><span></span></div>
  ${m.steps.map((s,j)=>`<div class="step"><select onchange="setKey(${i},${j},this.value)">${keyOptions(s.key)}</select>
   ${s.key?`<input type="number" min="1" max="50" value="${s.times}" oninput="macros[${i}].steps[${j}].times=+this.value">
   <input type="number" min="0" step="50" value="${s.pause}" oninput="macros[${i}].steps[${j}].pause=+this.value">`
   :`<span></span><input type="number" min="0" step="500" value="${s.wait}" title="Wartezeit ms" oninput="macros[${i}].steps[${j}].wait=+this.value">`}
   <span class="ctl"><button class="sm" onclick="mv(macros[${i}].steps,${j},-1);renderEdit()">&uarr;</button><button class="sm" onclick="mv(macros[${i}].steps,${j},1);renderEdit()">&darr;</button><button class="sm dan" onclick="macros[${i}].steps.splice(${j},1);renderEdit()">&times;</button></span></div>`).join('')}
  <div class="row" style="margin-top:6px"><button class="sm" onclick="macros[${i}].steps.push({key:'MENU',times:1,pause:400});renderEdit()">+ Taste</button>
  <button class="sm" onclick="macros[${i}].steps.push({wait:1000});renderEdit()">+ Warten</button></div></div>`).join('')}
function setKey(i,j,v){const s=macros[i].steps[j];macros[i].steps[j]=v?{key:v,times:s.times||1,pause:s.pause??400}:{wait:s.wait||1000};renderEdit()}
function mv(a,i,d){const j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]]}
function addMacro(){macros.push({name:'Neues Makro',steps:[]});renderEdit()}
async function saveMacros(){await api('/api/macros',{macros});toast('Makros gespeichert');renderRun()}

function renderKeys(){
 $('#keytable').innerHTML=keys.map((k,i)=>`<tr>
  <td><input value="${esc(k.label)}" style="width:100%" oninput="keys[${i}].label=this.value"><div class="mut">${esc(k.id)} &middot; ${codeText(k)}</div></td>
  <td class="act"><button class="sm" ${k.proto?'':'disabled'} onclick="sendKey('${esc(k.id)}')">Senden</button>
  <button class="sm ${state.learn&&state.learn.key===k.id?'on':''}" onclick="learn('${esc(k.id)}')">Lernen</button>
  <button class="sm" onclick="editCode(${i})">Hex</button>
  <button class="sm dan" onclick="if(confirm('Taste loeschen?')){keys.splice(${i},1);renderKeys()}">&times;</button></td></tr>`).join('')}
async function sendKey(id){await api('/api/send',{key:id});toast('Gesendet')}
async function learn(id){
 if(state.learn&&state.learn.key===id){await api('/api/learn',{key:''});return poll()}
 await api('/api/keys',{keys});await api('/api/learn',{key:id});poll()}
function editCode(i){const k=keys[i];
 const v=prompt('NEC-Code als ADRESSE:BEFEHL in hex, z.B. 18E9:0A\n(8-Bit-Adresse wie "18" wird automatisch zu 18E7 ergaenzt, leer = Code loeschen)',k.proto==='nec'?hex(k.addr,4)+':'+hex(k.cmd,2):'');
 if(v===null)return;if(v.trim()===''){keys[i]={id:k.id,label:k.label,proto:''};return renderKeys()}
 const m=v.trim().match(/^([0-9a-f]{1,4})\s*[:\/ ]\s*([0-9a-f]{1,2})$/i);if(!m)return toast('Format: 18E9:0A',true);
 let a=parseInt(m[1],16);if(m[1].length<=2)a=a|((~a&0xFF)<<8);
 keys[i]={id:k.id,label:k.label,proto:'nec',addr:a,cmd:parseInt(m[2],16)};renderKeys();toast('Mit "Tasten speichern" uebernehmen')}
function addKey(){const id=prompt('ID der neuen Taste (z.B. NUM1)');if(!id)return;
 const nid=id.trim().toUpperCase().replace(/\s+/g,'_');if(keys.find(k=>k.id===nid))return toast('ID existiert bereits',true);
 keys.push({id:nid,label:id.trim(),proto:''});renderKeys()}
async function saveKeys(){await api('/api/keys',{keys});toast('Tasten gespeichert');await load()}

async function saveSettings(){const b={ap_ssid:$('#ap_ssid').value,sta_ssid:$('#sta_ssid').value};
 if($('#ap_pass').value)b.ap_pass=$('#ap_pass').value;
 if($('#sta_pass').value)b.sta_pass=$('#sta_pass').value;
 await api('/api/settings',b);toast('Gespeichert – Geraet startet neu. Ggf. neu mit dem WLAN verbinden.')}
async function restore(inp){const f=inp.files[0];if(!f)return;try{const j=JSON.parse(await f.text());await api('/api/restore',j);toast('Backup eingespielt');load()}catch(e){toast('Backup ungueltig',true)}inp.value=''}
function uploadFw(){const f=$('#fwfile').files[0];if(!f)return toast('Bitte .bin-Datei waehlen',true);
 if(!confirm('Firmware "'+f.name+'" installieren? Das Geraet startet danach neu.'))return;
 const fd=new FormData();fd.append('firmware',f,f.name);const x=new XMLHttpRequest(),pr=$('#fwprog');
 pr.classList.remove('hide');pr.value=0;$('#fwbtn').disabled=true;
 x.upload.onprogress=e=>{if(e.lengthComputable)pr.value=Math.round(e.loaded*100/e.total)};
 x.onload=()=>{let j={};try{j=JSON.parse(x.responseText)}catch(e){}
  if(j.ok){toast('Update erfolgreich – Neustart, Seite laedt in 10 s neu');setTimeout(()=>location.reload(),10000)}
  else{toast(j.error||'Update fehlgeschlagen',true);$('#fwbtn').disabled=false}};
 x.onerror=()=>{toast('Verbindung abgebrochen',true);$('#fwbtn').disabled=false};
 x.open('POST','/api/update');x.send(fd)}
async function resetAll(){if(!confirm('Alle Tasten und Makros zuruecksetzen?'))return;await api('/api/reset',{});load()}

function renderStatus(){const r=state.run||{},l=state.learn||{},o=state.ota||{},el=$('#status');
 if(o.active){el.innerHTML=esc(o.msg);el.classList.remove('hide')}
 else if(r.running){el.innerHTML=`<div class="row"><div class="grow"><b>${esc(r.name)}</b><br><span class="mut">Schritt ${r.step}/${r.total}: ${esc(r.current)}</span></div><button class="dan" onclick="stopMacro()">Stopp</button></div>`;el.classList.remove('hide')}
 else if(l.key||l.msg){el.innerHTML=`<div class="row"><div class="grow">${esc(l.msg)}</div>${l.key?'<button onclick="api(\'/api/learn\',{key:\'\'})">Abbrechen</button>':''}</div>`;el.classList.remove('hide')}
 else el.classList.add('hide')}

async function poll(){try{state=await api('/api/state');
 renderStatus();
 if(lastLearn&&!state.learn.key){keys=state.keys;renderRun()}
 if(lastLearn!==state.learn.key)renderKeys();
 lastLearn=state.learn.key;}catch(e){}}
async function load(){state=await api('/api/state');keys=state.keys;macros=state.macros;
 $('#fwver').textContent=state.version||'?';const w=state.wifi;$('#ap_ssid').value=w.ap_ssid;$('#sta_ssid').value=w.sta_ssid||'';
 $('#wifiinfo').textContent=`Access Point: ${w.ap_ssid} (${w.ap_ip})`+(w.sta_ssid?` · WLAN ${w.sta_ssid}: ${w.sta_ip||'nicht verbunden'}`:'');
 renderRun();renderEdit();renderKeys();renderStatus()}
load();setInterval(poll,1000);
</script></body></html>)HTML";
