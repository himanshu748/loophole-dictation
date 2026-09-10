import {defaultRubric,validateRubric,rubricText} from './rubric.js';
import {mountRubricEditor} from './rubric-editor.js';
import {ROBOTS,SCENARIOS,DEFAULT_POLICY,initialState,search,searchAll,replay,violation,describePolicy,actionLabel,transition} from './engine.js';
import {EXAMPLES} from './compiler.js';
import {policyText,shareQuery,readSharedRule} from './rules.js';
import {startCapture} from './voice.js';
const $=id=>document.getElementById(id);
const paths={mic:'M9 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V4ZM5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',arrow:'M4 12h15m-6-6 6 6-6 6',search:'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 6 6',brackets:'M8 5H4v14h4m8-14h4v14h-4',world:'m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 0v20M3 7l9 5 9-5',flag:'M5 22V3m0 0c5-5 9 5 14 0v10c-5 5-9-5-14 0',reset:'M3 10a9 9 0 1 1 2 8M3 3v7h7',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-12v7m0-11v.1',play:'m8 4 12 8-12 8V4Z',pause:'M8 4v16M16 4v16',back:'m14 5-7 7 7 7',forward:'m10 5 7 7-7 7',external:'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',check:'m5 12 4 4L19 6',alert:'m12 3 10 18H2L12 3Zm0 6v5m0 3v.1',stop:'M5 5h14v14H5z'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.info}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
const escape=text=>String(text).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
let rubric=defaultRubric('checkpoint');
let policy={...DEFAULT_POLICY},appliedText=EXAMPLES[0].text,pending=null,dirty=false,busy=false,recording=null,recordStarting=false,scenario='tailgate',result=null,trace=[],original=null,step=0,timer=null,comparison=false,speech=null,history=[],manual=false;
const blankDescription='Both robots are waiting outside. Atlas has a blue badge. Pip has a red badge.';
const errors={NotAllowedError:'Microphone access was declined. Allow it in your browser, or type your rule.',NotFoundError:'No microphone was found. Connect one, or type your rule.',NotReadableError:'The microphone is busy. Close other recording apps and try again.'};

async function api(route,body,type='application/json') {
  let res;try{res=await fetch(route,{method:'POST',headers:{'Content-Type':type,'X-Loophole-Client':'web'},body:type==='application/json'?JSON.stringify(body):body,signal:AbortSignal.timeout(100000)});}catch{throw new Error('The voice service could not be reached. Retry, or use Build a rule with controls. Your applied rule is unchanged.');}
  const data=await res.json();if(!res.ok)throw new Error(data.error||'The request failed. Please retry.');return data;
}
function message(text,notice=false) {$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('notice',notice);}
function setBusy(value,label) {busy=value;updateControls();if(label)$('primary-label').textContent=label;}
function updateControls() {
  $('primary').disabled=busy||!!recording||recordStarting||!$('rule').value.trim();
  $('primary-label').textContent=pending?'Apply & find loophole':dirty?'Review rule':'Find a loophole';
  $('rule').disabled=busy||!!recording||recordStarting;
  $('mic').disabled=busy||recordStarting;
  $('sample').disabled=busy||!!recording||recordStarting;
  if($('suggest-fix'))$('suggest-fix').disabled=busy||!!recording||recordStarting;
  $('scenario').disabled=busy||!!recording||recordStarting;
  $('discard').hidden=!pending;$('discard').disabled=busy;
  document.querySelectorAll('.example-button,.history-item').forEach(b=>b.disabled=busy||!!recording||recordStarting);
  $('export').disabled=!result;
  $('share').disabled=busy||!!recording||recordStarting;
  document.querySelectorAll('#builder select,#use-builder,[data-move],#manual-reset,#rubric-editor button,#rubric-editor input,#rubric-editor select').forEach(b=>b.disabled=busy||!!recording||recordStarting);
}
function renderMeaning() {
  const p=pending?.policy||policy;
  $('build-trigger').value=p.trigger;$('build-passage').value=p.passage;$('build-recheck').value=p.recheck?'1':'0';
  $('interpret-title').textContent=pending?'Review this interpretation':dirty?'Current world rule':'What this means';
  $('meaning').innerHTML=describePolicy(p).map(x=>`<div><dt>${escape(x.label)}</dt><dd>${escape(x.value)}</dd></div>`).join('');
  document.querySelector('.interpretation').classList.toggle('pending',!!pending);
  $('assumptions').innerHTML=pending?`<p>${pending.source==='builder'?'Built directly from your controls.':pending.source==='example'?'Built-in example interpretation.':'AI interpretation. Check it against your words.'}</p>`+((pending.notes||[]).length?`<details><summary>Interpretation notes (${pending.notes.length})</summary>${pending.notes.map(x=>`<p>${escape(x)}</p>`).join('')}</details>`:''):dirty?'<p>Your edits have not been applied to the world.</p>':'';
}
function renderHistory() {
  document.querySelector('.revision-block').hidden=!history.length;
  $('history').innerHTML=history.map((h,i)=>`<button class="history-item ${h.text===appliedText?'current':''}" data-index="${i}" title="${escape(h.text)}">R${String(i+1).padStart(2,'0')} · ${escape(h.text.slice(0,50))}${h.text.length>50?'…':''}</button>`).join('');
  $('history').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>loadDraft(history[Number(b.dataset.index)].text)));
}
function loadDraft(text) {if(busy||recording||recordStarting)return;stopPlayback();$('rule').value=text;dirty=text!==appliedText;pending=null;speech=null;$('speech-proof').hidden=true;message('');renderMeaning();updateControls();$('rule').focus();}
function renderScene() {
  const current=step>0?trace[step-1]:null,s=current?.state||initialState();
  const atlasInside=s.inside.includes('B-01'),pipInside=s.inside.includes('R-02');
  $('atlas').setAttribute('transform',`translate(${atlasInside?652:323} 183)`);
  $('pip').setAttribute('transform',`translate(${pipInside?535:atlasInside||scenario==='theft'?337:157} ${!pipInside&&!atlasInside&&scenario==='theft'?245:183})`);
  $('gate').classList.toggle('open',s.gate);
  $('gate-status').textContent=s.gate?'GATE OPEN':'GATE CLOSED';
  $('scanner-light').setAttribute('fill',s.gate?'#c9e78e':'#cad6bb');
  $('revoked-mark').setAttribute('visibility',s.revoked.length?'visible':'hidden');
  $('blocked-mark').setAttribute('visibility',current&&!current.allowed&&current.action.type==='enter'?'visible':'hidden');
  $('scene-state').textContent=current?(!current.allowed?'This rule blocks the move':violation(s,rubric)?'The exception is inside':`${actionLabel(current.action)}`):'Ready to experiment';
  $('scene').setAttribute('aria-label',`${atlasInside?'Atlas is inside.':'Atlas is outside.'} ${pipInside?'Pip is inside.':'Pip is outside.'} Gate ${s.gate?'open':'closed'}.${s.revoked.length?' Atlas badge revoked.':''}`);
  $('event-description').textContent=current?.explanation||blankDescription;
  $('step-count').textContent=`${step} / ${trace.length} moves`;
  $('scrub').max=trace.length;$('scrub').value=step;
  $('prev').disabled=step===0;$('next').disabled=step===trace.length;
  document.querySelectorAll('.trace-step').forEach((el,i)=>{el.classList.toggle('active',i===step-1);el.setAttribute('aria-current',i===step-1?'step':'false');});
}
function renderTrace() {
  $('timeline').hidden=!trace.length;
  $('trace-title').textContent=manual?'Your moves':comparison?'Original moves · revised rule':'The counterexample';
  $('trace-steps').innerHTML=trace.map((t,i)=>`<button class="trace-step ${!t.allowed?'blocked':''}" data-step="${i+1}"><span class="step-number">0${i+1}${!t.allowed?' · BLOCKED':''}</span><span class="step-label">${escape(actionLabel(t.action))}</span></button>`).join('');
  $('trace-steps').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{stopPlayback();step=Number(b.dataset.step);renderScene();}));
  $('replay-original').hidden=manual||!original||JSON.stringify(original.policy)===JSON.stringify(policy);
  renderScene();
}
function renderResult() {
  if(!result)return;
  $('result').classList.toggle('safe',!result.found);
  let heading,detail;
  if(result.found){heading='There’s a loophole.';detail=`A permitted sequence breaks your rubric: ${rubricText('checkpoint',rubric)}`;
  }else{heading='No loophole in this experiment.';detail=original?'The revised rule holds across every reachable state in this experiment. Replay the original moves to see what changed.':'Every reachable state was checked. The goal holds within this experiment’s stated boundaries.';}
  const help=result.found&&JSON.stringify(rubric)===JSON.stringify(defaultRubric('checkpoint'))?`<button id="suggest-fix" class="fix-button">Try a more precise rule ${icon('arrow')}</button>`:'';
  $('result').innerHTML=`<div class="result-summary"><div class="result-symbol">${icon(result.found?'alert':'check')}</div><div><h3>${heading}</h3><p>${escape(detail)}</p><p class="result-meta">Rubric: ${escape(rubric.name)} · ${result.states} states explored · ${result.transitions} transitions · ${result.found?'shortest counterexample':'complete reachable-state search'}</p>${help}</div></div>`;
  $('suggest-fix')?.addEventListener('click',()=>{loadDraft(EXAMPLES[3].text);$('rule').scrollIntoView({behavior:'smooth',block:'center'});});
  $('search-bounds').innerHTML=`${icon('info')}<span>${escape(SCENARIOS[scenario].detail)} ${result.found?'Search stopped at the first shortest violation.':'All reachable states exhausted.'} Two robots, one gate; no real-world guarantee.</span>`;
}
function mobileHandoff(id){
  if(!matchMedia('(max-width:760px)').matches)return;
  const target=$(id);target.setAttribute('tabindex','-1');target.focus({preventScroll:true});
  target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});
}
function runSearch() {
  stopPlayback();message('');comparison=false;manual=false;
  result=search(policy,scenario,rubric);
  if(result.found) {trace=result.trace;original={trace:structuredClone(trace),policy:{...policy},rubric:{...rubric},text:appliedText,scenario};}
  else if(original&&original.scenario===scenario){trace=replay(original.trace,policy,scenario,rubric);comparison=true;}
  else trace=[];
  step=0;renderResult();renderTrace();renderAll();updateControls();save();
  mobileHandoff('world-title');
  if(trace.length)playTrace();
}
function stopPlayback(){if(timer)clearTimeout(timer);timer=null;$('play-label').textContent='Replay';$('play').querySelector('[data-icon]').innerHTML=icon('play');}
function playTrace(){if(!trace.length)return;if(timer){stopPlayback();return;}if(step>=trace.length)step=0;$('play-label').textContent='Pause';$('play').querySelector('[data-icon]').innerHTML=icon('pause');renderScene();const next=()=>{step++;renderScene();if(step>=trace.length)stopPlayback();else timer=setTimeout(next,1500);};timer=setTimeout(next,650);}
function save(){try{localStorage.setItem('loophole-session-v1',JSON.stringify({text:appliedText,policy,rubric,history}));}catch{}}
function recordVersion(){history.push({text:appliedText,policy:{...policy},rubric:{...rubric},speech:speech?{...speech}:null,createdAt:new Date().toISOString()});history=history.slice(-20);$('version').textContent=`RULE ${String(history.length).padStart(2,'0')}`;renderHistory();}
$('rule').addEventListener('input',()=>{dirty=$('rule').value!==appliedText;pending=null;speech=null;$('speech-proof').hidden=true;message('');renderMeaning();updateControls();});
$('primary').addEventListener('click',async()=>{
  if(pending){manual=false;policy=pending.policy;appliedText=$('rule').value;pending=null;dirty=false;recordVersion();renderMeaning();runSearch();return;}
  if(!dirty){runSearch();return;}
  setBusy(true,'Interpreting your rule…');message('');
  try{pending=await api('/api/compile',{text:$('rule').value});renderMeaning();mobileHandoff('interpret-title');}
  catch(e){message(e.message);}
  finally{setBusy(false);}
});
$('discard').addEventListener('click',()=>{pending=null;loadDraft(appliedText);});
$('scenario').addEventListener('change',()=>{scenario=$('scenario').value;$('manual-revoke').hidden=scenario!=='revoked';original=null;result=null;trace=[];step=0;runSearch();});
$('reset').addEventListener('click',()=>{stopPlayback();step=0;renderScene();});
$('play').addEventListener('click',playTrace);
$('prev').addEventListener('click',()=>{stopPlayback();step=Math.max(0,step-1);renderScene();});
$('next').addEventListener('click',()=>{stopPlayback();step=Math.min(trace.length,step+1);renderScene();});
$('scrub').addEventListener('input',()=>{stopPlayback();step=Number($('scrub').value);renderScene();});
$('replay-original').addEventListener('click',()=>{if(!original)return;stopPlayback();comparison=true;trace=replay(original.trace,policy,original.scenario,rubric);step=0;renderTrace();playTrace();});
$('example-list').innerHTML=EXAMPLES.map((x,i)=>`<button class="example-button" data-index="${i}">${escape(x.name)}${icon('arrow')}</button>`).join('');
$('example-list').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>loadDraft(EXAMPLES[Number(b.dataset.index)].text)));

async function transcribeAudio(audio) {
  setBusy(true,'Transcribing…');$('mic').classList.remove('recording');$('mic-label').textContent='Transcribing…';$('mic').setAttribute('aria-label','Transcribing recording');$('voice-meter').classList.remove('live');
  try{
    if(!audio||audio.byteLength<8000)throw new Error('That recording was too short. Try a complete sentence.');
    speech=await api('/api/transcribe',audio,'audio/pcm');
    $('rule').value=speech.cleaned;dirty=true;pending=null;
    $('speech-proof').hidden=false;
    $('speech-text').innerHTML=`<p><strong>Original</strong><br>${escape(speech.text)}</p><p><strong>Cleaned</strong><br>${escape(speech.cleaned)}</p><p>${escape((speech.elapsedMs/1000).toFixed(1))}s response · ${speech.cleanupAvailable?'cleanup available':'original transcript retained'}</p>`;
    $('voice-status').textContent='Transcribed by AssemblyAI. Review the words, then review the rule.';
    renderMeaning();message('');
  }catch(e){message(e.message);$('voice-status').textContent='Recording ended. Your applied rule is unchanged.';}
  finally{$('mic-label').textContent='Dictate a rule';$('mic').setAttribute('aria-label','Start recording a rule');$('record-time').textContent='';setBusy(false);}
}
async function stopRecording() {
  if(!recording)return;
  const capture=recording;recording=null;setBusy(true,'Finishing recording…');
  try {await transcribeAudio(await capture.stop());}
  catch(e){message(e.message);setBusy(false);}
}
$('sample').addEventListener('click',async()=>{
  setBusy(true,'Loading sample…');message('');stopPlayback();
  try {const res=await fetch('/sample.pcm');if(!res.ok)throw new Error('The sample recording could not be loaded.');await transcribeAudio(await res.arrayBuffer());}
  catch(e){message(e.message);setBusy(false);}
});
$('mic').addEventListener('click',async()=>{
  if(recording){await stopRecording();return;}
  if(recordStarting||busy)return;
  if(!navigator.mediaDevices?.getUserMedia){message('Recording requires HTTPS or localhost and a browser with microphone support. You can still type a rule.');return;}
  message('');stopPlayback();recordStarting=true;updateControls();
  try{
    recording=await startCapture((level,seconds)=>{$('record-time').textContent=`${Math.floor(seconds)}s`;$('voice-meter').querySelectorAll('i').forEach((bar,i)=>{bar.style.transform=`scaleY(${(4+Math.min(22,level*180*(1+Math.sin(i*1.4+seconds*3))))/26})`;});},stopRecording);
    $('mic').classList.add('recording');$('mic-label').textContent='Finish recording';$('mic').setAttribute('aria-label','Finish recording');$('voice-meter').classList.add('live');$('voice-status').textContent='Listening. Speak your rule, then finish. Maximum 55 seconds.';
  }catch(e){message(errors[e.name]||e.message);}
  finally{recordStarting=false;updateControls();}
});
$('export').addEventListener('click',()=>{
  const evidence={product:'Loophole',version:3,exportedAt:new Date().toISOString(),rubric:{...rubric},goal:rubricText('checkpoint',rubric),model:{robots:ROBOTS,scenarios:SCENARIOS,limits:'Two robots, one gate. No real hardware, timing, escorts or arbitrary objects.'},rule:{text:appliedText,policy},history,selectedExperiment:scenario,result,manualMoves:manual?trace:null,originalCounterexample:original,replay:comparison?trace:null,allExperiments:searchAll(policy,rubric)};
  const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='loophole-experiment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
});

function renderAll(){
  $('all-results').innerHTML=searchAll(policy,rubric).map(r=>`<button data-experiment="${r.scenario}" class="experiment-result ${r.found?'fails':'holds'}"><span>${escape(SCENARIOS[r.scenario].name)}</span><strong>${r.found?'Loophole found':'Holds in model'}</strong></button>`).join('');
  $('all-results').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{if(busy||recording||recordStarting)return;scenario=b.dataset.experiment;$('scenario').value=scenario;$('manual-revoke').hidden=scenario!=='revoked';original=null;runSearch();}));
}
$('use-builder').addEventListener('click',()=>{
  const built={trigger:$('build-trigger').value,passage:$('build-passage').value,recheck:$('build-recheck').value==='1'};
  loadDraft(policyText(built));pending={policy:built,source:'builder',notes:[]};dirty=true;renderMeaning();updateControls();mobileHandoff('interpret-title');
});
function manualMove(action){
  if(busy||recording||recordStarting)return;
  stopPlayback();
  if(!manual){manual=true;comparison=false;trace=[];step=0;}
  trace=trace.slice(0,step);
  if(trace.length>=50){message('This replay has 50 moves. Start your moves over to keep exploring.');return;}
  if(action){const state=trace.at(-1)?.state||initialState();trace.push({action,...transition(state,action,policy,scenario,rubric)});}
  step=trace.length;const last=trace.at(-1),broken=last&&violation(last.state,rubric);
  if(broken)original={trace:structuredClone(trace),policy:{...policy},rubric:{...rubric},text:appliedText,scenario,source:'manual'};
  result=null;
  $('result').classList.toggle('safe',false);
  $('result').innerHTML=`<div class="empty-result"><div><h3>${broken?'You found a loophole.':last&&!last.allowed?'That move is blocked.':'You control the robots.'}</h3><p>${escape(last?.explanation||'Scan a badge, try crossing, or switch experiments to revoke a badge. No search has run for these moves.')}</p></div></div>`;
  renderTrace();updateControls();$('export').disabled=!trace.length;
}
document.querySelectorAll('[data-move]').forEach(b=>b.addEventListener('click',()=>{const [type,robot]=b.dataset.move.split(':');manualMove({type,robot});}));
$('manual-reset').addEventListener('click',()=>{manual=false;manualMove(null);});
$('share').addEventListener('click',async()=>{
  const url=new URL('/play',location.origin);url.search=shareQuery(policy,scenario,rubric);
  try{await navigator.clipboard.writeText(url.href);message('Link copied. It shares the applied rule, rubric and experiment, without your transcript or history.',true);}
  catch{message(`Copy this rule link: ${url.href}`,true);}
});

// Restore only applied text/policy after schema validation; drafts never silently apply.
try{const saved=JSON.parse(localStorage.getItem('loophole-session-v1'));if(!location.search&&saved&&typeof saved.text==='string'&&saved.text.length<=2000){const restoredRubric=saved.rubric===undefined?defaultRubric('checkpoint'):validateRubric('checkpoint',saved.rubric);search(saved.policy,'tailgate',restoredRubric);rubric=restoredRubric;policy=saved.policy;appliedText=saved.text;$('rule').value=appliedText;history=Array.isArray(saved.history)?saved.history.filter(h=>typeof h.text==='string').slice(-20):[];$('version').textContent=history.length?`RULE ${String(history.length).padStart(2,'0')}`:'RESTORED RULE';}}catch{}
fetch('/api/health').then(r=>r.json()).then(h=>{if(!h.speechConfigured){$('voice-status').textContent='Voice needs a server API key. Built-in rules are ready to explore.';}}).catch(()=>{$('voice-status').textContent='Voice service is unreachable. You can explore the starter rule.';});
try{
  const shared=readSharedRule(location.search);
  if(shared){rubric=shared.rubric;policy=shared.policy;appliedText=shared.text;scenario=shared.scenario;$('rule').value=appliedText;$('version').textContent='SHARED RULE';}
  else {const challenge=new URLSearchParams(location.search).get('challenge');if(['tailgate','theft','revoked'].includes(challenge)){scenario=challenge;const example=EXAMPLES[challenge==='tailgate'?0:challenge==='theft'?1:2];policy={...example.policy};appliedText=example.text;$('rule').value=appliedText;}}
}catch(e){message(e.message);}
$('scenario').value=scenario;$('manual-revoke').hidden=scenario!=='revoked';
if(new URLSearchParams(location.search).get('builder')==='1')$('builder').open=true;
function applyRubric(next){
  rubric=validateRubric('checkpoint',next);original=null;trace=[];step=0;comparison=false;manual=false;runSearch();
  message('Rubric applied. The rule is unchanged; all test cases were recalculated.',true);
}
mountRubricEditor('checkpoint',rubric,applyRubric,()=>busy||!!recording||recordStarting);
renderMeaning();renderHistory();renderScene();renderAll();updateControls();
window.addEventListener('pagehide',()=>{stopPlayback();recording?.stop();});
