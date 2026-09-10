import {DEFAULT_POLICY,FIXED_POLICY,search,replay,initialState} from './engine.js';
const $=id=>document.getElementById(id),original=search(DEFAULT_POLICY,'tailgate').trace;
function show(fixed){
 const trace=fixed?replay(original,FIXED_POLICY,'tailgate'):original,s=trace.at(-1)?.state||initialState();
 $('atlas').setAttribute('transform',`translate(${s.inside.includes('B-01')?652:323} 183)`);
 $('pip').setAttribute('transform',`translate(${s.inside.includes('R-02')?535:337} 183)`);
 $('gate').classList.toggle('open',s.gate);$('scanner-light').setAttribute('fill',s.gate?'#c9e78e':'#cad6bb');
 $('blocked-mark').setAttribute('visibility',fixed?'visible':'hidden');
 $('scene').setAttribute('aria-label',fixed?'Revised rule: Atlas is inside, Pip is blocked outside the closed gate.':'Loose rule: Atlas and Pip are both inside the open gate.');
 $('preview-loose').setAttribute('aria-pressed',String(!fixed));$('preview-fixed').setAttribute('aria-pressed',String(fixed));
 $('preview-rule').textContent=fixed?'“Only the robot that scanned may cross.”':'“Open the gate when a blue badge arrives.”';
 $('preview-outcome').textContent=fixed?'Same three moves. This time, Pip stays outside.':'The blue badge opens the gate. The red robot follows.';
 $('preview-icon').querySelector('path').setAttribute('d',fixed?'m5 12 4 4L19 6':'m12 3 10 18H2L12 3Zm0 6v5m0 3v.1');document.querySelector('.hero-proof').classList.toggle('fixed',fixed);
}
$('preview-loose').addEventListener('click',()=>show(false));$('preview-fixed').addEventListener('click',()=>show(true));show(false);

// The landing deck illustrates the supplied audio; real Dictation starts in /create.
const object=$('dictation-object'),play=$('play-transformation');
const stageButtons=[...document.querySelectorAll('[data-dictation-stage]')];
const planes=[$('plane-voice'),$('plane-transcript'),$('plane-world')];
const captions=['Describe your world naturally, including corrections.','Dictation keeps the original transcript for you to inspect.','The same request extracts a rubric with the corrected three-tool limit.'];
let timers=[];
function stopTransformation(){timers.forEach(clearTimeout);timers=[];play.firstChild.textContent='Play transformation ';play.setAttribute('aria-label','Play transformation');}
function selectStage(index){
 object.dataset.stage=String(index);
 stageButtons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
 planes.forEach((plane,i)=>plane.setAttribute('aria-hidden',String(i!==index)));
 $('stage-caption').textContent=captions[index];
}
stageButtons.forEach((button,index)=>button.addEventListener('click',()=>{stopTransformation();selectStage(index);}));
play.addEventListener('click',()=>{
 if(timers.length){stopTransformation();return;}
 selectStage(0);play.firstChild.textContent='Pause transformation ';play.setAttribute('aria-label','Pause transformation');
 timers=[setTimeout(()=>selectStage(1),1100),setTimeout(()=>selectStage(2),2200),setTimeout(stopTransformation,2900)];
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTransformation();});
if('IntersectionObserver' in window)new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)stopTransformation();},{threshold:.1}).observe(object);
