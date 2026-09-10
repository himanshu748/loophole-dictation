import {defaultRubric,validateRubric,rubricText} from './rubric.js';
import {mountRubricEditor} from './rubric-editor.js';
import {domainFor,domainText,domainMeaning,validateDomainPolicy,domainInitial,domainActions,domainStep,domainSearch,domainSearchAll,domainReplay,domainSnapshot} from './domains.js';
import {startCapture} from './voice.js';
const $=id=>document.getElementById(id),escape=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const query=new URLSearchParams(location.search);
let world=query.get('world')||'coupons',initialError='';
try{domainFor(world);}catch{world='coupons';initialError='That world is unavailable. Coupon redemption is ready instead.';}
const domain=domainFor(world);
let rubric=defaultRubric(world);
let policy={...domain.starter},scenario=Object.keys(domain.scenarios)[0],appliedText=domainText(world,policy),pending=null,busy=false,capture=null,starting=false,speech=null,appliedSpeech=null,result=null,trace=[],original=null,step=0,manual=false;
if(world==='approvals')scenario='edited';
if(query.has('test')&&Object.hasOwn(domain.scenarios,query.get('test')))scenario=query.get('test');
try {
  if(query.has('rule')) {
    policy=validateDomainPolicy(world,JSON.parse(query.get('rule')));
    const requested=query.get('test')||scenario;if(!Object.hasOwn(domain.scenarios,requested))throw new Error('Unknown test case.');
    scenario=requested;appliedText=domainText(world,policy);
  }
}catch{policy={...domain.starter};appliedText=domainText(world,policy);initialError='This shared rule is invalid. The starter rule is ready instead.';}
try{if(query.has('rubric'))rubric=validateRubric(world,JSON.parse(query.get('rubric')));}catch{initialError='This shared rubric is invalid. The default rubric is active; create or edit it below.';}
function message(text){$('message').textContent=text;$('message').hidden=!text;}
function locked(){return busy||starting||!!capture;}
function controls(){
  document.querySelectorAll('.lab-editor button,.lab-editor select,.lab-editor textarea,#scenario,#actions button,#manual-reset,#share,#all-results button,#rubric-editor button,#rubric-editor input,#rubric-editor select').forEach(el=>el.disabled=locked());
  $('mic').disabled=busy||starting;
  $('primary').disabled=locked()||!$('rule').value.trim();
  $('primary').textContent=busy?'Working…':pending?'Apply & find loophole':$('rule').value!==appliedText?'Review rule':'Find a loophole';
  $('discard').hidden=!pending&&$('rule').value===appliedText;
  $('export').disabled=locked()||(!result&&!manual);
}
function meaning(){
  const p=pending?.policy||policy;
  for(const f of domain.fields)$('field-'+f.key).value=String(p[f.key]);
  $('meaning-title').textContent=pending?'Review this interpretation':'Applied rule';
  $('meaning').innerHTML=domainMeaning(world,p).map(x=>`<div><dt>${escape(x.label)}</dt><dd>${escape(x.value)}</dd></div>`).join('');
  $('notes').textContent=pending?(pending.source==='builder'?'Built from your controls. ':pending.source==='example'?'Built-in interpretation. ':'AI interpretation. Check it against your words. ')+(pending.notes||[]).join(' '):$('rule').value!==appliedText?'Your draft has not changed the applied rule.':'';
}
function setDraft(text,p=null){if(locked())return;$('rule').value=text;pending=p;speech=null;$('speech-proof').hidden=true;message('');meaning();controls();}
async function api(route,body,type='application/json') {
  let response;
  try{response=await fetch(route,{method:'POST',headers:{'Content-Type':type,'X-Loophole-Client':'web'},body:type==='application/json'?JSON.stringify(body):body,signal:AbortSignal.timeout(100000)});}catch{throw new Error('The voice service could not be reached. Try again or build a rule with controls.');}
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The request failed. Your applied rule is unchanged.');return data;
}
function focusWorld(){if(matchMedia('(max-width:760px)').matches){const target=$('result');target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({behavior:'instant',block:'start'});}}
function renderState(){
  const current=trace[step-1],state=current?.state||domainInitial(world);
  $('snapshot').innerHTML=domainSnapshot(world,state).map(row=>`<div class="state-row"><strong>${escape(row.label)}</strong><span>${escape(row.value)}</span><span>${escape(row.detail)}</span></div>`).join('');
  $('event').textContent=current?`${current.allowed?'':'Blocked. '}${current.explanation}`:'Ready for the first move.';
  $('step-count').textContent=`${step} / ${trace.length} moves`;
  $('next').disabled=step>=trace.length;$('reset').disabled=step===0;
  document.querySelectorAll('#trace button').forEach((el,i)=>el.setAttribute('aria-current',i===step-1?'step':'false'));
}
function renderTrace(){
  $('playback').hidden=!trace.length;
  $('trace').innerHTML=trace.map((t,i)=>`<button data-step="${i+1}" class="${t.allowed?'':'blocked'}"><span>${i+1}${t.allowed?'':' · BLOCKED'}</span>${escape(t.action.label)}</button>`).join('');
  $('trace').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{step=Number(b.dataset.step);renderState();}));
  $('replay-original').hidden=!original||JSON.stringify(original.policy)===JSON.stringify(policy);
  renderState();
}
function renderAll(){
  $('all-results').innerHTML=domainSearchAll(world,policy,rubric).map(r=>`<button data-test="${r.scenario}" class="${r.found?'fails':'holds'}"><span>${escape(domain.scenarios[r.scenario].name)}</span><strong>${r.found?'Loophole found':'Holds in model'}</strong></button>`).join('');
  $('all-results').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{if(locked())return;changeScenario(b.dataset.test);}));
}
function renderActions(){
  $('actions').innerHTML=domainActions(world,scenario).map((a,i)=>`<button data-action="${i}">${escape(a.label)}</button>`).join('');
  $('actions').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>manualMove(domainActions(world,scenario)[Number(b.dataset.action)])));
}
function showResult(){
  $('result').className=`lab-result ${result.found?'fails':'holds'}`;
  $('result').innerHTML=`<h3>${result.found?'There’s a loophole.':'The goal holds in this model.'}</h3><p>${escape(result.found?result.trace.at(-1).state.breach:'Every reachable state in this test case was checked. Try the other cases or change a rule.')}</p><p class="lab-small">Rubric: ${escape(rubric.name)} · ${result.states} states explored · ${result.transitions} transitions · ${result.found?'shortest counterexample':'complete search'}</p>`;
}
function run(){
  manual=false;result=domainSearch(world,policy,scenario,rubric);showResult();
  if(result.found){trace=result.trace;original={policy:{...policy},rubric:{...rubric},text:appliedText,scenario,trace:structuredClone(trace)};$('trace-title').textContent='The counterexample';}
  else if(original?.scenario===scenario){trace=domainReplay(world,original.trace,policy,scenario,rubric);$('trace-title').textContent='Original moves · revised rule';}
  else{trace=[];$('trace-title').textContent='The counterexample';}
  step=0;renderTrace();renderAll();controls();focusWorld();
}
function changeScenario(value){scenario=value;$('scenario').value=value;$('scenario-detail').textContent=domain.scenarios[value].detail;original=null;renderActions();run();}
function manualMove(action){
  if(locked())return;
  manual=true;trace=trace.slice(0,step);
  if(trace.length>=40){message('Start your moves over to continue beyond 40 actions.');return;}
  if(action){const state=trace.at(-1)?.state||domainInitial(world);trace.push({action,...domainStep(world,state,action,policy,scenario,rubric)});}
  step=trace.length;result=null;$('trace-title').textContent='Your actions';
  const current=trace.at(-1);
  if(current?.state.breach)original={policy:{...policy},rubric:{...rubric},text:appliedText,scenario,trace:structuredClone(trace),source:'manual'};
  $('result').className='lab-result';$('result').innerHTML=`<h3>${current?.state.breach?'You found a loophole.':'You control the experiment.'}</h3><p>${escape(current?.explanation||'Choose an action above. These moves have not run an exhaustive search.')}</p>`;
  renderTrace();controls();
}
$('title').textContent=domain.title;$('world-title').textContent=domain.name;$('bounds').textContent=domain.bounds;
document.title=`Loophole · ${domain.name}`;
document.querySelector(`[data-world="${world}"]`).setAttribute('aria-current','page');
$('scenario').innerHTML=Object.entries(domain.scenarios).map(([key,s])=>`<option value="${key}">${escape(s.name)}</option>`).join('');$('scenario').value=scenario;$('scenario-detail').textContent=domain.scenarios[scenario].detail;
$('fields').innerHTML=domain.fields.map(f=>`<label for="field-${f.key}">${escape(f.label)}</label><select id="field-${f.key}">${Object.entries(f.options).map(([v,l])=>`<option value="${v}" ${String(policy[f.key])===v?'selected':''}>${escape(l)}</option>`).join('')}</select>`).join('');
$('rule').value=appliedText;
$('rule').addEventListener('input',()=>{pending=null;speech=null;$('speech-proof').hidden=true;message('');meaning();controls();});
$('primary').addEventListener('click',async()=>{
  if(pending){policy=validateDomainPolicy(world,pending.policy);appliedText=$('rule').value;appliedSpeech=speech?{...speech}:null;pending=null;meaning();run();return;}
  if($('rule').value===appliedText){run();return;}
  busy=true;controls();message('');
  try{const data=await api('/api/compile',{domain:world,text:$('rule').value});pending={...data,policy:validateDomainPolicy(world,data.policy)};meaning();}
  catch(e){message(e.message);}finally{busy=false;controls();}
});
$('use-builder').addEventListener('click',()=>{
  const p=Object.fromEntries(domain.fields.map(f=>[f.key,f.key==='recheck'?$('field-'+f.key).value==='true':$('field-'+f.key).value]));
  setDraft(domainText(world,p),{policy:p,source:'builder',notes:[]});
});
$('starter').addEventListener('click',()=>setDraft(domainText(world,domain.starter),{policy:{...domain.starter},source:'example',notes:[]}));
$('fixed').addEventListener('click',()=>setDraft(domainText(world,domain.fixed),{policy:{...domain.fixed},source:'example',notes:[]}));
$('discard').addEventListener('click',()=>setDraft(appliedText));
$('scenario').addEventListener('change',()=>changeScenario($('scenario').value));
$('reset').addEventListener('click',()=>{step=0;renderState();});
$('next').addEventListener('click',()=>{step=Math.min(trace.length,step+1);renderState();});
$('replay-original').addEventListener('click',()=>{if(!original)return;manual=false;result=domainSearch(world,policy,scenario,rubric);showResult();trace=domainReplay(world,original.trace,policy,scenario,rubric);step=0;$('trace-title').textContent='Original moves · revised rule';renderTrace();controls();});
$('manual-reset').addEventListener('click',()=>{trace=[];step=0;manualMove(null);});
$('share').addEventListener('click',async()=>{
  const url=new URL('/lab',location.origin);url.search=new URLSearchParams({world,rule:JSON.stringify(policy),test:scenario,rubric:JSON.stringify(rubric)});
  try{await navigator.clipboard.writeText(url.href);message('Link copied. It shares the applied rule, rubric and test case, without your transcript.');}catch{message(`Copy this rule link: ${url.href}`);}
});
$('export').addEventListener('click',()=>{
  const evidence={product:'Loophole',version:3,domain:world,rubric:{...rubric},goal:rubricText(world,rubric),bounds:domain.bounds,rule:{text:appliedText,policy},scenario,result,manualMoves:manual?trace:null,original,displayedReplay:trace,allResults:domainSearchAll(world,policy,rubric),speech:appliedSpeech,exportedAt:new Date().toISOString()};
  const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`loophole-${world}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
});
async function finishRecording(){
  if(!capture)return;const recorded=capture;capture=null;busy=true;controls();$('mic').textContent='Transcribing…';
  try{
    const audio=await recorded.stop();if(!audio||audio.byteLength<8000)throw new Error('That recording was too short. Try a complete sentence.');
    speech=await api('/api/transcribe',audio,'audio/pcm');$('rule').value=speech.cleaned;pending=null;
    $('raw-speech').textContent=`Original\n${speech.text}`;$('clean-speech').textContent=`${speech.cleanupAvailable?'Cleaned':'Original retained'}\n${speech.cleaned||'(empty)'}`;$('speech-proof').hidden=false;
    message(speech.cleaned.trim()?'Transcribed by AssemblyAI. Review the words, then review the rule.':'Cleanup returned empty text. Open the original transcript and type a rule if needed.');meaning();
  }catch(e){message(e.message);}finally{busy=false;$('mic').textContent='Dictate a rule';$('record-time').textContent='';controls();}
}
$('mic').addEventListener('click',async()=>{
  if(capture){await finishRecording();return;}if(locked())return;
  if(!navigator.mediaDevices?.getUserMedia){message('Microphone recording needs HTTPS or localhost. You can still type a rule.');return;}
  starting=true;controls();message('');
  try{capture=await startCapture((_,seconds)=>$('record-time').textContent=`${Math.floor(seconds)}s / 55s`,finishRecording);$('mic').textContent='Finish recording';message('Listening. Speak your rule, then finish recording.');}
  catch(e){message(e.name==='NotAllowedError'?'Microphone access was declined. Enable it in your browser or type the rule.':e.message);}
  finally{starting=false;controls();}
});
window.addEventListener('pagehide',()=>{capture?.stop();capture=null;});
function applyRubric(next){
  rubric=validateRubric(world,next);original=null;trace=[];step=0;manual=false;run();
  message('Rubric applied. The rule is unchanged; all test cases were recalculated.');
}
mountRubricEditor(world,rubric,applyRubric,locked);
renderActions();renderAll();renderState();meaning();controls();message(initialError);
