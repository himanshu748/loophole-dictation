import {startCapture} from './voice.js';
import {validateBrief,validateAnalysis,worldInitial,worldViolations,worldStep,worldSearch,worldReplay,describePredicate} from './world-model.js';
import {encodeWorld,decodeWorld} from './world-share.js';
const $=id=>document.getElementById(id),escape=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const exampleAirlock='My world is a space station airlock. An astronaut can open or close its inner and outer doors. Both doors start closed. The current rules allow either door to open at any time. My rubric is that both doors must never be open at once.';
const exampleFestival='My world is a neighborhood art festival. Artists propose installations for the public square. Organizers choose whatever they consider interesting. My rubric is that the festival should feel welcoming to first-time visitors and represent different local perspectives.';
let busy=false,capture=null,starting=false,speech=null,briefSpeech=null,briefEdited=false,briefSource=null,lastCounterexample=[],proposal=null,applied=null,previous=null,result=null,trace=[],step=0,manual=false;
const locked=()=>busy||starting||!!capture;
function message(text){$('message').textContent=text;$('message').hidden=!text;}
function controls(){
  document.querySelectorAll('.creator-bench button,.creator-bench textarea,#share,#export').forEach(el=>el.disabled=locked());
  $('record').disabled=busy||starting;
  $('extract').disabled=locked()||!$('description').value.trim();
  $('share').disabled=locked()||!applied;$('export').disabled=locked()||!applied;
  $('apply').disabled=locked()||!proposal;
  $('next').disabled=locked()||step>=trace.length;$('start').disabled=locked()||step===0;
}
function focusPanel(id){const target=$(id);target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({behavior:'instant',block:'start'});}
async function api(route,body,type='application/json'){
  let response;try{response=await fetch(route,{method:'POST',headers:{'Content-Type':type,'X-Loophole-Client':'web'},body:type==='application/json'?JSON.stringify(body):body,signal:AbortSignal.timeout(100000)});}catch{throw new Error('The service could not be reached. Your description is still here; retry when connected.');}
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The request failed. Your current world is unchanged.');return data;
}
function analysisMessage(text){$('analysis-message').textContent=text;$('analysis-message').hidden=!text;}
function receiptText(r){return `${r.provider} · ${(r.elapsedMs/1000).toFixed(1)}s${r.model?' · '+r.model:''}${r.jsonSyntaxRepaired?' · JSON syntax repaired; review the model carefully':''}`;}
function draftChanged(){analysisMessage('');briefEdited=true;proposal=null;$('proposal-panel').hidden=true;if(applied)$('applied-note').textContent='Your draft changes have not changed this applied world.';controls();}
function showBrief(input,source,sourceSpeech=null){
  const brief=validateBrief(input);briefSource=source;briefSpeech=sourceSpeech?structuredClone(sourceSpeech):null;
  $('brief-world').value=brief.world;
  for(const k of ['actors','resources','rules','rubric'])$('brief-'+k).value=brief[k].join('\n');
  $('empty-world').hidden=true;$('brief-panel').hidden=false;$('brief-source').textContent=source;
  draftChanged();briefEdited=false;focusPanel('brief-title');
}
function readBrief(){return validateBrief({world:$('brief-world').value,...Object.fromEntries(['actors','resources','rules','rubric'].map(k=>[k,$('brief-'+k).value.split('\n').map(x=>x.trim()).filter(Boolean)]))},{complete:true});}
function showSpeech(data,label){
  speech={...data,input:label};$('description').value=data.text;
  $('speech-receipt').hidden=false;$('speech-summary').textContent=`${data.brief?'Transcript + structured world returned':'Transcript returned'} · ${(data.receipt.elapsedMs/1000).toFixed(1)}s · ${label}${data.receipt.jsonSyntaxRepaired?' · JSON syntax repaired':''}`;
  $('speech-original').textContent=data.text;
  $('speech-metadata').innerHTML=[['Endpoint',data.receipt.endpoint],['Session',data.receipt.requestId||'Not returned'],['Audio duration',data.receipt.durationMs==null?'Not returned':(data.receipt.durationMs/1000).toFixed(1)+'s']].map(([k,v])=>`<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('');
  $('speech-structured').textContent=typeof data.structured==='string'?data.structured:'Structured rewrite unavailable.';
  if(data.brief)showBrief(data.brief,'Extracted directly by AssemblyAI Dictation in the same request as your transcript. Review every field.',speech);
  message(data.warning||'AssemblyAI returned your world and rubric. Review them before preparing a test.');
}
async function sendRecording(audio,label){
  busy=true;controls();$('record-status').textContent='AssemblyAI is transcribing and extracting the world, rules and rubric…';message('');
  try{if(!audio||audio.byteLength<8000)throw new Error('The recording is too short. Speak a description or use the sample.');showSpeech(await api('/api/world/transcribe',audio,'audio/pcm'),label);$('record-status').textContent='Dictation complete. The original transcript and endpoint response are below.';}
  catch(e){message(e.message);$('record-status').textContent='The request did not finish. Your applied world is unchanged.';}
  finally{busy=false;$('record-label').textContent='Speak your world & rubric';controls();}
}
async function finishRecording(){if(!capture)return;const recorded=capture;capture=null;busy=true;controls();try{await sendRecording(await recorded.stop(),'Microphone recording');}catch(e){message(e.message);}finally{busy=false;$('record-label').textContent='Speak your world & rubric';controls();}}
$('record').addEventListener('click',async()=>{
  if(capture){await finishRecording();return;}if(locked())return;
  if(!navigator.mediaDevices?.getUserMedia){message('Microphone input needs HTTPS or localhost. You can type a description or transcribe the sample.');return;}
  starting=true;controls();message('');
  try{capture=await startCapture((_,seconds)=>$('record-status').textContent=`Recording · ${Math.floor(seconds)}s / 55s. Describe your world, rules and rubric.`,finishRecording);$('record-label').textContent='Finish recording';}
  catch(e){message(e.name==='NotAllowedError'?'Microphone access was declined. Enable it in your browser, type your world or use the sample.':e.message);}
  finally{starting=false;controls();}
});
$('sample').addEventListener('click',async()=>{if(locked())return;busy=true;controls();try{const response=await fetch('/world-sample.pcm');if(!response.ok)throw new Error('The sample could not be loaded. Use your microphone or type a world.');await sendRecording(await response.arrayBuffer(),'Synthetic sample recording');}catch(e){message(e.message);}finally{busy=false;controls();}});
$('description').addEventListener('input',()=>{controls();});
for(const [id,value] of [['airlock-example',exampleAirlock],['festival-example',exampleFestival]])$(id).addEventListener('click',()=>{if(locked())return;$('description').value=value;message('Example text loaded. Extract world from text makes a real AssemblyAI LLM Gateway request.');controls();});
$('extract').addEventListener('click',async()=>{
  if(locked())return;busy=true;controls();message('AssemblyAI is extracting your world and rubric…');
  try{const data=await api('/api/world/interpret',{text:$('description').value});showBrief(data.brief,`Extracted from typed text by ${receiptText(data.receipt)}. This was not a speech request.`);speech=null;$('speech-receipt').hidden=true;message('Review the extracted world and your rubric.');}
  catch(e){message(e.message);}finally{busy=false;controls();}
});
for(const k of ['world','actors','resources','rules','rubric'])$('brief-'+k).addEventListener('input',draftChanged);
function modelDetails(model,brief){
  return `<h3>Model assumptions</h3><ul>${model.assumptions.map(s=>`<li>${escape(s)}</li>`).join('')}</ul><h3>State and bounds</h3>${model.variables.map(v=>`<div class="model-row"><strong>${escape(v.label)}</strong><span>Starts at ${escape(String(v.initial))} · values: ${escape(v.values.join(', '))}</span></div>`).join('')}<h3>Permitted actions</h3>${model.actions.map(a=>`<div class="model-row"><strong>${escape(a.label)}</strong><span>When: ${escape(describePredicate(a.when,model))}</span><span>${a.effects.map(e=>escape(model.variables.find(v=>v.id===e.variable).label)+': '+(Object.hasOwn(e,'set')?escape(String(e.set)):(e.add>0?'+':'')+e.add)).join(' · ')}</span><span>From ${a.ruleIndexes.map(i=>'rule '+(i+1)).join(', ')}</span></div>`).join('')}<h3>Your rubric mapped to checks</h3>${model.criteria.map(c=>`<div class="model-row"><strong>${escape(brief.rubric[c.rubricIndex])}</strong><span>${escape(describePredicate(c.holds,model))}</span></div>`).join('')}<p class="quiet-note">The search checks at most 6,000 states and 24 moves. Limits reached produce an inconclusive result, never a pass. Actions beyond a variable's declared values are outside this model.</p>`;
}
async function prepareAnalysis(reviewOnly=false){
  if(locked())return;let brief;try{brief=readBrief();}catch(e){analysisMessage(e.message);return;}
  proposal=null;$('proposal-panel').hidden=true;message('');busy=true;controls();analysisMessage(reviewOnly?'AssemblyAI is critiquing each requirement in your rubric…':'AssemblyAI is preparing a model or critique for your reviewed brief…');
  try{
    const data=await api('/api/world/analyze',{brief,reviewOnly});const analysis=validateAnalysis(data.analysis,brief);proposal={brief,analysis,receipt:data.receipt,speech:briefSpeech?structuredClone(briefSpeech):null,briefEdited};
    $('proposal-title').textContent=analysis.mode==='simulation'?'Review the proposed model':'Review an AI critique';$('proposal-explanation').textContent=analysis.explanation;
    $('proposal-details').innerHTML=analysis.mode==='simulation'?modelDetails(analysis,brief):`<p class="quiet-note">This subject needs judgment or clarification. The critique covers your ${brief.rubric.length} rubric requirements with hypothetical scenarios and proposed revisions. It is not a simulation or proof.</p>`;
    $('analysis-receipt').textContent=receiptText(data.receipt);$('apply').textContent=analysis.mode==='simulation'?'Apply model & find a loophole':'Open AI critique';$('proposal-panel').hidden=false;analysisMessage('Review the assumptions and criteria before applying this analysis.');focusPanel('proposal-title');
  }catch(e){analysisMessage(e.message);}finally{busy=false;controls();}
}
$('analyze').addEventListener('click',()=>prepareAnalysis());
$('review-only').addEventListener('click',()=>prepareAnalysis(true));
function renderResult(){
  $('result').className=result.found?'fails':result.exhaustive?'holds':'';
  const heading=result.found?(result.trace.length?'A counterexample in this model.':'The initial state breaks your rubric.'):result.exhaustive?'Your rubric holds within this model.':'Search incomplete. No verdict yet.';
  const detail=result.found?result.violations.map(i=>applied.brief.rubric[i]).join(' '):result.exhaustive?'Every reachable state inside the reviewed model was checked. This does not verify the real-world system.':'The state or depth limit was reached. No counterexample was found in the explored portion; this is not a passing result.';
  $('result').innerHTML=`<h3>${heading}</h3><p>${escape(detail)}</p><p class="quiet-note">${result.states} states · ${result.transitions} transitions · ${result.found?'concrete action sequence':result.exhaustive?'complete search within model bounds':'inconclusive search'}${result.boundaries?' · '+result.boundaries+' actions reached model boundaries':''}</p>`;
}
function renderState(){
  const model=applied.analysis,state=trace[step-1]?.state||worldInitial(model),move=trace[step-1];
  $('world-state').innerHTML=model.variables.map(v=>`<div class="world-state-row"><strong>${escape(v.label)}</strong><span>${escape(String(state[v.id]))}</span></div>`).join('');
  $('move-description').textContent=move?`${step} / ${trace.length} · ${move.allowed?'':'Blocked: '}${move.reason}`:'Initial state of your reviewed model.';
  document.querySelectorAll('#trace button').forEach((b,i)=>b.setAttribute('aria-current',i===step-1?'step':'false'));controls();
}
function renderTrace(){
  $('trace').innerHTML=trace.map((m,i)=>`<button data-step="${i+1}" class="${m.allowed?'':'blocked'}"><span>${i+1}${m.allowed?'':' · BLOCKED'}</span><span>${escape(m.label)}</span></button>`).join('');
  $('trace').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{step=Number(b.dataset.step);renderState();}));renderState();
}
function runSearch(){manual=false;result=worldSearch(applied.analysis);trace=result.trace;if(result.found)lastCounterexample=structuredClone(trace);step=0;renderResult();renderTrace();}
function comparable(old,next){return old?.analysis.mode==='simulation'&&next.mode==='simulation'&&old.trace?.length&&old.trace.every(t=>next.actions.some(a=>a.id===t.action&&a.label===t.label));}
function activate(bundle,{shared=false}={}){
  const brief=validateBrief(bundle.brief,{complete:true}),analysis=validateAnalysis(bundle.analysis,brief);
  previous=applied?.analysis.mode==='simulation'?{analysis:applied.analysis,brief:applied.brief,trace:structuredClone(lastCounterexample)}:null;
  applied={version:1,brief,analysis,receipt:bundle.receipt||null,speech:bundle.speech||null,briefEdited:!!bundle.briefEdited,source:shared?'Shared world':'Reviewed analysis'};proposal=null;lastCounterexample=[];
  $('empty-world').hidden=true;$('proposal-panel').hidden=true;$('applied-panel').hidden=false;$('applied-title').textContent=brief.world;$('applied-mode').textContent=analysis.mode==='simulation'?'Reviewed simulation':'AI critique · hypotheses';
  $('applied-note').textContent=shared?'Shared world. No new AssemblyAI request was made to open it.':'Applied from your reviewed brief. Edits above remain drafts until you apply another analysis.';
  $('applied-rubric').innerHTML=`<h3>Your applied rubric</h3><ol>${brief.rubric.map(r=>`<li>${escape(r)}</li>`).join('')}</ol>`;
  $('simulation').hidden=analysis.mode!=='simulation';$('critique').hidden=analysis.mode!=='review';
  if(analysis.mode==='simulation'){
    $('state-guide').hidden=!analysis.assumptions.length;$('state-guide').open=true;$('state-assumptions').innerHTML=analysis.assumptions.map(s=>`<li>${escape(s)}</li>`).join('');
    $('applied-model').innerHTML=modelDetails(analysis,brief);$('manual-actions').innerHTML=analysis.actions.map(a=>`<button class="button quiet" data-action="${escape(a.id)}">${escape(a.label)}</button>`).join('');
    $('manual-actions').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>manualMove(b.dataset.action)));
    $('replay-previous').hidden=!comparable(previous,analysis);runSearch();
  }else{
    result=null;trace=[];step=0;manual=false;$('result').className='';$('result').innerHTML='<h3>Scenarios to investigate.</h3><p>This is AI critique, not an executed simulation. No pass or failure has been proved.</p>';
    const labels={potential_gap:'Potential gap',needs_clarification:'Needs clarification',no_obvious_gap:'No obvious gap · unverified'};
    $('critique').innerHTML=analysis.assessments.map(a=>`<article class="assessment"><h3>${escape(brief.rubric[a.rubricIndex])}</h3><p class="assessment-status">${labels[a.status]}</p><p><strong>Hypothetical scenario</strong><br>${escape(a.scenario)}</p><p>${escape(a.reasoning)}</p><p><strong>Suggested revision</strong><br>${escape(a.suggestedRevision)}</p></article>`).join('');
  }
  controls();focusPanel('result');
}
$('apply').addEventListener('click',()=>{if(locked()||!proposal)return;activate(proposal);message('Analysis applied. You can inspect, revise, share or export this world.');});
function manualMove(action){
  if(locked())return;
  const model=applied.analysis,state=trace[step-1]?.state||worldInitial(model);
  if(worldViolations(model,state).length){message('This sequence already breaks the rubric. Reset your moves to start another sequence.');return;}
  if(step>=50){message('Reset your moves to continue beyond 50 actions.');return;}
  manual=true;trace=trace.slice(0,step);trace.push({action,label:model.actions.find(a=>a.id===action).label,...worldStep(model,state,action)});step=trace.length;result=null;
  const move=trace.at(-1),violations=worldViolations(model,move.state);if(violations.length)lastCounterexample=structuredClone(trace);$('result').className=violations.length?'fails':'';$('result').innerHTML=`<h3>${violations.length?'Your moves break the rubric.':'Your manual sequence.'}</h3><p>${escape(violations.length?violations.map(i=>applied.brief.rubric[i]).join(' '):'No exhaustive search has been run for this sequence.')}</p>`;renderTrace();
}
$('manual-reset').addEventListener('click',()=>{trace=[];step=0;result=null;manual=true;$('result').className='';$('result').innerHTML='<h3>Try the actions yourself.</h3><p>Start from the initial state. Manual moves are not an exhaustive search.</p>';renderTrace();});
$('start').addEventListener('click',()=>{step=0;renderState();});$('next').addEventListener('click',()=>{step=Math.min(step+1,trace.length);renderState();});$('rerun').addEventListener('click',runSearch);
$('replay-previous').addEventListener('click',()=>{if(!comparable(previous,applied.analysis))return;manual=false;result=worldSearch(applied.analysis);trace=worldReplay(applied.analysis,previous.trace);step=0;renderResult();renderTrace();message('Previous actions replayed under the new model. The verdict above comes from a fresh search.');});
$('share').addEventListener('click',async()=>{if(!applied||locked())return;try{const url=new URL('/create',location.origin);url.hash=new URLSearchParams({world:encodeWorld(applied)});await navigator.clipboard.writeText(url.href);message('Link copied. It contains the applied world, rules, rubric and model or critique. It excludes your recording and transcript.');}catch(e){message(e.message||'The link could not be copied. Export evidence instead.');}});
$('export').addEventListener('click',()=>{if(!applied||locked())return;const evidence={product:'Loophole',format:'custom-world',version:1,exportedAt:new Date().toISOString(),applied,result,manual,displayedTrace:trace,previousCounterexample:previous,limits:'Simulation results apply only to reviewed model bounds. AI critique contains unverified hypotheses.'};const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='loophole-custom-world.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);});
function loadSharedWorld(){if(locked())return;try{const encoded=new URLSearchParams(location.hash.slice(1)).get('world');if(encoded){const bundle=decodeWorld(encoded);showBrief(bundle.brief,'Shared world. Review the description and model assumptions.');activate(bundle,{shared:true});message('Shared world loaded. No new AssemblyAI request was made.');}}catch(e){message(e.message);}}
window.addEventListener('hashchange',loadSharedWorld);loadSharedWorld();
window.addEventListener('pagehide',()=>{capture?.stop();capture=null;});controls();
