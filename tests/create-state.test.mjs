import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import * as model from '../public/world-model.js';import * as sharing from '../public/world-share.js';import * as workspaceTools from '../public/world-workspace.js';import * as comparisonTools from '../public/world-comparison.js';
const brief={world:'A counting game',actors:['Player'],resources:['Tokens'],rules:['Start with no tokens. Take one token at a time.'],rubric:['Hold at most one token.']};
const analysis={mode:'simulation',explanation:'A bounded token count',assumptions:['At most two tokens in this model'],variables:[{id:'tokens',label:'Tokens',values:[0,1,2],initial:0}],actions:[{id:'take',label:'Take a token',ruleIndexes:[0],when:true,effects:[{variable:'tokens',add:1}]}],criteria:[{rubricIndex:0,holds:{variable:'tokens',op:'lte',value:1}}]};
function browserStorage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const workspaceKey='loophole.workspace.v1';
function creator({storage=browserStorage(),hash='',captureFactory,requestHandler}={}){const nodes=new Map(),requests=[];let exported,shared,apiCalls=0,searchCalls=0;
 function node(tag='div',attributes=''){
  const attrs=Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]])),dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));
  let childHTML,children=[];
  return {tag,value:attrs.value||'',textContent:'',innerHTML:'',hidden:/(?:^|\s)hidden(?:\s|$)/.test(attributes),disabled:/(?:^|\s)disabled(?:\s|$)/.test(attributes),checked:false,dataset,attrs,handlers:{},addEventListener(k,fn){this.handlers[k]=fn;},setAttribute(k,v){this.attrs[k]=String(v);},click(){return this.handlers.click?.();},querySelectorAll(selector){
   if(childHTML!==this.innerHTML){childHTML=this.innerHTML;children=[...childHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(m=>{const b=node('button',m[1]);b.innerHTML=m[2];return b;});}
   if(selector==='button')return children;
   const attribute=selector.match(/^\[([^\]]+)\]$/)?.[1];return attribute?children.filter(b=>Object.hasOwn(b.attrs,attribute)):[];
  },focus(){},scrollIntoView(){}};
 }
 for(const match of readFileSync(new URL('../public/create.html',import.meta.url),'utf8').matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)){const id=match[2].match(/\bid="([^"]+)"/)?.[1];if(id)nodes.set(id,node(match[1],match[2]));}
 function element(id){assert.ok(nodes.has(id),`Creator references missing #${id}`);return nodes.get(id);}
 function querySelectorAll(selector){
  if(selector==='#trace button')return element('trace').querySelectorAll('button');
  if(selector.startsWith('[data-'))return [...nodes.values()].flatMap(n=>n.querySelectorAll(selector));
  if(selector.startsWith('.creator-bench '))return [...nodes.values()].filter(n=>['button','textarea','input'].includes(n.tag));
  return [];
 }
 class TestURL extends URL{static createObjectURL(blob){exported=blob;return 'blob:test';}static revokeObjectURL(){}}
 const location={hash,origin:'http://localhost',pathname:'/create'},events={};
 const context=vm.createContext({...model,...sharing,...workspaceTools,...comparisonTools,startCapture:captureFactory,worldSearch:(...args)=>{searchCalls++;return model.worldSearch(...args);},URL:TestURL,URLSearchParams,Blob,structuredClone,location,history:{replaceState(_state,_title,path){const target=new URL(path,location.origin);location.hash=target.hash;location.pathname=target.pathname;}},navigator:{mediaDevices:captureFactory?{getUserMedia:async()=>({})}:undefined,clipboard:{async writeText(s){shared=s;}}},document:{getElementById:element,querySelectorAll,createElement:()=>({click(){}})},window:{localStorage:storage,addEventListener(k,fn){events[k]=fn;}},fetch:async(route,options)=>{apiCalls++;requests.push({route,options});if(requestHandler)return requestHandler(route,options);throw new Error('Unexpected provider call during local workflow');},AbortSignal,setTimeout(){}});
 vm.runInContext(readFileSync(new URL('../public/create.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
 const run=code=>vm.runInContext(code,context);context.bundle={brief:structuredClone(brief),analysis:structuredClone(analysis)};
 return {element,run,storage,requests,exported:()=>exported,shared:()=>shared,apiCalls:()=>apiCalls,searchCalls:()=>searchCalls,readWorkspace:()=>workspaceTools.readWorkspace(storage),dispatchStorage:key=>events.storage?.({key}),importText:async text=>{element('world-file').files=[{size:Buffer.byteLength(text),text:async()=>text}];await element('world-file').handlers.change();}};
}
test('applying a generated model runs the actual search and manual counterexamples survive a revision',()=>{const a=creator();a.run('activate(bundle)');assert.equal(a.run('result.found'),true);a.element('manual-reset').handlers.click();a.run("manualMove('take');manualMove('take')");assert.match(a.element('result').innerHTML,/Your moves break/);a.run("const fixed=structuredClone(bundle);fixed.analysis.actions[0].when={variable:'tokens',op:'lt',value:1};activate(fixed)");assert.equal(a.run('result.found'),false);assert.equal(a.run('previous.trace.length'),2);a.element('replay-previous').handlers.click();assert.equal(a.run('trace.at(-1).allowed'),false);});
test('critique has no simulation verdict and replacing it does not retain stale simulation evidence',()=>{const a=creator();a.run('activate(bundle)');a.run("activate({brief:bundle.brief,analysis:{mode:'review',explanation:'Needs judgment',assessments:[{rubricIndex:0,status:'needs_clarification',scenario:'A possible issue',reasoning:'A definition is missing.',suggestedRevision:'Define success.'}]}})");assert.equal(a.run('result'),null);assert.equal(a.run('trace.length'),0);assert.match(a.element('result').innerHTML,/not an executed simulation/);assert.equal(a.element('simulation').hidden,true);assert.equal(a.element('critique').hidden,false);});
test('editing the brief invalidates a pending model but leaves the applied model intact',()=>{const a=creator();a.run('activate(bundle);proposal=bundle;draftChanged()');assert.equal(a.run('proposal'),null);assert.equal(a.run('applied.brief.world'),brief.world);assert.equal(a.element('apply').disabled,true);assert.match(a.element('applied-note').textContent,/have not changed/);});
test('new speech without a structured draft cannot replace the previous draft speech provenance',()=>{const a=creator();a.run("showBrief(bundle.brief,'First source',{text:'First recording'});speech={text:'Later failed extraction'}");assert.equal(a.run('briefSpeech.text'),'First recording');assert.equal(a.run('briefEdited'),false);a.run('draftChanged()');assert.equal(a.run('briefEdited'),true);});
test('shared world excludes speech and exported evidence retains the reviewed model and result',async()=>{const a=creator();a.run("activate({...bundle,speech:{text:'Original voice'},briefEdited:true})");await a.element('share').handlers.click();const fragment=new URLSearchParams(new URL(a.shared()).hash.slice(1));const shared=sharing.decodeWorld(fragment.get('world'));assert.equal('speech' in shared,false);await a.element('export').handlers.click();const out=JSON.parse(await a.exported().text());assert.equal(out.applied.briefEdited,true);assert.equal(out.applied.speech.text,'Original voice');assert.equal(out.result.found,true);});
test('a new shared-world fragment replaces the displayed world without a provider call',()=>{const a=creator();a.run("location.hash='#world='+encodeWorld({version:1,...bundle});loadSharedWorld()");assert.equal(a.run('applied.source'),'Shared world');assert.equal(a.run('result.found'),true);assert.match(a.element('message').textContent,/No new AssemblyAI request/);});

test('draft recovery requires opt-in and restores incomplete raw fields without applying a result',()=>{
 const a=creator();assert.equal(a.element('brief-panel').hidden,true);assert.equal(a.element('applied-panel').hidden,true);
 a.element('description').value='  My unfinished world\n';a.element('description').handlers.input();
 assert.equal(a.storage.getItem(workspaceKey),null);
 a.element('remember-draft').checked=true;a.element('remember-draft').handlers.change();
 a.element('brief-actors').value=' Player\n\n Visitor ';a.element('brief-actors').handlers.input();
 a.element('brief-rubric').value='\n  Define success later  \n';a.element('brief-rubric').handlers.input();
 const stored=a.readWorkspace().draft;
 assert.equal(stored.fields.world,'');assert.equal(stored.edited,true);
 const b=creator({storage:a.storage});
 assert.equal(b.element('remember-draft').checked,true);
 assert.equal(b.element('description').value,'  My unfinished world\n');
 assert.equal(b.element('brief-actors').value,' Player\n\n Visitor ');
 assert.equal(b.element('brief-rubric').value,'\n  Define success later  \n');
 assert.equal(b.element('brief-panel').hidden,false);assert.equal(b.element('speech-receipt').hidden,true);
 assert.equal(b.element('applied-panel').hidden,true);assert.equal(b.run('applied'),null);
 assert.equal(b.apiCalls(),0);assert.equal(b.searchCalls(),0);
});

test('saved versions omit speech and receipts and reopening recalculates instead of trusting a stored verdict',()=>{
 const a=creator();a.run("showBrief(bundle.brief,'Original');activate({...bundle,speech:{text:'PRIVATE TRANSCRIPT'},receipt:{requestId:'PRIVATE RECEIPT'}})");
 a.element('world-name').value='Original rule';a.element('save-world').click();
 const saved=a.readWorkspace().worlds[0];assert.equal(saved.title,'Original rule');
 assert.doesNotMatch(a.storage.getItem(workspaceKey),/PRIVATE|speech|receipt|result/);
 // A stale verdict in externally edited storage is deliberately ignored.
 const stored=JSON.parse(a.storage.getItem(workspaceKey));stored.worlds[0].bundle.result={found:false,exhaustive:true,trace:[]};
 a.storage.setItem(workspaceKey,JSON.stringify(stored));
 const b=creator({storage:a.storage,hash:'#other=value'});assert.equal(b.searchCalls(),0);
 b.element('saved-worlds').querySelectorAll('[data-open-world]')[0].click();
 assert.equal(b.searchCalls(),1);assert.equal(b.run('result.found'),true);assert.equal(b.run('trace.length'),2);
 assert.equal(b.run('applied.source'),'Saved world');assert.equal(b.run('applied.speech'),null);assert.equal(b.run('applied.receipt'),null);
 assert.equal(b.run('location.hash'),'');assert.equal(b.element('world-name').value,'Original rule');
 assert.equal(b.apiCalls(),0);
});

test('disabling draft recovery removes only the draft and leaves current fields and named worlds intact',()=>{
 const a=creator();a.run("showBrief(bundle.brief,'Typed example');activate(bundle)");
 a.element('world-name').value='Saved rules';a.element('save-world').click();
 a.element('remember-draft').checked=true;a.element('remember-draft').handlers.change();
 a.element('description').value='Private idea';a.element('description').handlers.input();
 assert.equal(a.readWorkspace().draft.description,'Private idea');
 a.element('remember-draft').checked=false;a.element('remember-draft').handlers.change();
 assert.equal(a.readWorkspace().draft,null);assert.equal(a.readWorkspace().worlds.length,1);
 assert.equal(a.element('description').value,'Private idea');assert.equal(a.run('applied.brief.world'),brief.world);
 a.element('description').value='Later unsaved change';a.element('description').handlers.input();assert.equal(a.readWorkspace().draft,null);
 const b=creator({storage:a.storage});assert.equal(b.element('remember-draft').checked,false);assert.equal(b.element('description').value,'');assert.equal(b.readWorkspace().worlds.length,1);
});

test('save, remove and undo operate on the selected named world without changing the applied model',()=>{
 const a=creator();a.run('activate(bundle)');
 a.element('world-name').value='First version';a.element('save-world').click();
 a.element('world-name').value='Second version';a.element('save-world').click();
 const before=a.readWorkspace().worlds,removed=before[0];
 assert.deepEqual(before.map(w=>w.title),['Second version','First version']);
 a.element('saved-worlds').querySelectorAll('[data-remove-world]')[0].click();
 assert.deepEqual(a.readWorkspace().worlds.map(w=>w.title),['First version']);assert.equal(a.element('undo-remove').hidden,false);
 assert.equal(a.run('applied.brief.world'),brief.world);
 a.element('undo-remove').click();
 assert.deepEqual(a.readWorkspace().worlds,before);assert.equal(a.readWorkspace().worlds[0].id,removed.id);assert.equal(a.element('undo-remove').hidden,true);
 assert.equal(a.apiCalls(),0);
});

test('invalid imports preserve the applied world, draft, and current verdict',async()=>{
 const a=creator();a.run("showBrief(bundle.brief,'Original draft');activate(bundle)");
 const applied=a.run('JSON.stringify(applied)'),result=a.run('JSON.stringify(result)');
 const invalid=JSON.stringify({version:1,brief,analysis:{...analysis,criteria:[]}});
 for(const input of ['invalid JSON',invalid]){
  await a.importText(input);
  assert.equal(a.run('JSON.stringify(applied)'),applied);assert.equal(a.run('JSON.stringify(result)'),result);
  assert.equal(a.element('brief-world').value,brief.world);assert.equal(a.element('proposal-panel').hidden,true);
  assert.match(a.element('workspace-message').textContent,/JSON|validated/);
  assert.equal(a.run('busy'),false);assert.equal(a.element('world-file').value,'');
 }
 assert.equal(a.apiCalls(),0);
});

test('valid import stays a reviewed proposal until explicit apply and then performs a fresh local search',async()=>{
 const a=creator();a.run('activate(bundle)');const searchesBefore=a.searchCalls();
 const fixed=structuredClone(analysis);fixed.actions[0].when={variable:'tokens',op:'lt',value:1};
 const importedBrief={...brief,world:'Imported counting game'};
 const evidence={product:'Loophole',format:'custom-world',version:1,applied:{version:1,brief:importedBrief,analysis:fixed,speech:{text:'PRIVATE'},receipt:{requestId:'PRIVATE'}},result:{found:true}};
 await a.importText(JSON.stringify(evidence));
 assert.equal(a.run('applied.brief.world'),brief.world);assert.equal(a.run('result.found'),true);
 assert.equal(a.element('brief-world').value,importedBrief.world);assert.equal(a.run('proposal.brief.world'),importedBrief.world);
 assert.equal(a.element('proposal-panel').hidden,false);assert.equal(a.element('apply').disabled,false);
 assert.doesNotMatch(a.run('JSON.stringify(proposal)'),/PRIVATE|speech|receipt|result/);
 assert.equal(a.searchCalls(),searchesBefore);assert.equal(a.apiCalls(),0);
 a.element('apply').click();
 assert.equal(a.run('applied.brief.world'),importedBrief.world);assert.equal(a.run('result.found'),false);assert.equal(a.run('result.exhaustive'),true);
 assert.equal(a.searchCalls(),searchesBefore+1);assert.equal(a.run('proposal'),null);assert.equal(a.element('proposal-panel').hidden,true);
});

test('a critique suggestion edits only the draft and cannot append the same suggestion twice',()=>{
 const a=creator();a.run("showBrief(bundle.brief,'Original');activate({brief:bundle.brief,analysis:{mode:'review',explanation:'Needs judgment',assessments:[{rubricIndex:0,status:'needs_clarification',scenario:'A possible issue',reasoning:'A definition is missing.',suggestedRevision:'Allow a token only while\\nthe player holds none.'}]}})");
 const before=a.run('JSON.stringify(applied)'),button=a.element('critique').querySelectorAll('[data-revision]')[0];
 button.click();
 assert.equal(a.element('brief-rules').value,brief.rules[0]+'\nAllow a token only while the player holds none.');
 assert.equal(a.run('JSON.stringify(applied)'),before);assert.equal(a.run('briefEdited'),true);assert.equal(a.run('result'),null);
 const after=a.element('brief-rules').value;button.click();
 assert.equal(a.element('brief-rules').value,after);assert.match(a.element('analysis-message').textContent,/already in your draft/);
 assert.equal(a.apiCalls(),0);
});

test('applying a revision exposes both fresh verdicts and the rule diff with model-bound caveats',()=>{
 const a=creator();a.run('activate(bundle)');assert.equal(a.element('comparison-panel').hidden,true);
 a.run("const revision=structuredClone(bundle);revision.brief.rules=['Take a token only while holding no tokens.'];revision.analysis.actions[0].when={variable:'tokens',op:'lt',value:1};proposal=revision;controls()");
 assert.equal(a.element('comparison-panel').hidden,true);a.element('apply').click();
 assert.equal(a.element('comparison-panel').hidden,false);
 assert.equal(a.run('comparison.before.found'),true);assert.equal(a.run('comparison.after.found'),false);assert.equal(a.run('comparison.after.exhaustive'),true);
 assert.match(a.element('comparison-results').innerHTML,/Counterexample found/);assert.match(a.element('comparison-results').innerHTML,/Holds within model/);
 assert.match(a.element('comparison-diff').innerHTML,/Take a token only while holding no tokens/);
 assert.match(a.element('comparison-note').textContent,/not proof of a fix/);
 a.element('close-comparison').click();assert.equal(a.element('comparison-panel').hidden,true);
});

test('opening a share link preserves an existing recovery draft and clears stale speech from the page',()=>{
 const a=creator();a.element('remember-draft').checked=true;a.element('remember-draft').handlers.change();
 a.element('description').value='My private unfinished description';a.element('description').handlers.input();
 a.run("showBrief(bundle.brief,'Original speech',{text:'Old transcript'});speech={text:'Old transcript'}");
 a.element('speech-receipt').hidden=false;a.element('speech-original').textContent='Old transcript';
 const stored=a.storage.getItem(workspaceKey);
 a.run("location.hash='#world='+encodeWorld({version:1,...bundle,brief:{...bundle.brief,world:'A shared world'}});loadSharedWorld()");
 assert.equal(a.storage.getItem(workspaceKey),stored);
 assert.equal(a.element('description').value,'');assert.equal(a.element('speech-receipt').hidden,true);
 assert.equal(a.run('speech'),null);assert.equal(a.run('briefSpeech'),null);assert.equal(a.run('applied.speech'),null);
 assert.equal(a.element('brief-world').value,'A shared world');assert.equal(a.run('suspendDraftPersistence'),false);
 const b=creator({storage:a.storage,hash:'#other=value'});
 // Ordinary recreation still recovers the preserved draft, regardless of an unrelated fragment.
 assert.equal(b.element('description').value,'My private unfinished description');
 const c=creator({storage:a.storage,hash:'#world='+sharing.encodeWorld({version:1,brief:{...brief,world:'Shared on initial load'},analysis})});
 assert.equal(c.element('brief-world').value,'Shared on initial load');assert.equal(c.storage.getItem(workspaceKey),stored);
 assert.equal(c.apiCalls(),0);
});

test('applying reviewed edits advances progress while retaining the applied provenance flag',()=>{
 const a=creator();a.run("showBrief(bundle.brief,'Original');briefEdited=true;proposal={...bundle,briefEdited:true};controls()");
 assert.equal(a.element('progress-review').attrs['aria-current'],'step');
 a.element('apply').click();
 assert.equal(a.run('briefEdited'),false);assert.equal(a.run('applied.briefEdited'),true);
 assert.equal(a.element('progress-test').attrs['aria-current'],'step');
});

test('speech without a structured brief still updates an opted-in recovery description',()=>{
 const a=creator();a.run("showBrief(bundle.brief,'Original draft')");
 a.element('remember-draft').checked=true;a.element('remember-draft').handlers.change();
 const originalFields=a.readWorkspace().draft.fields;
 a.run("showSpeech({text:'A new recording with no extracted brief.',receipt:{elapsedMs:1200,endpoint:'https://dictation.assemblyai.com/transcribe',requestId:'PRIVATE_SESSION'},warning:'Structured rewrite unavailable.'},'Synthetic sample')");
 assert.equal(a.readWorkspace().draft.description,'A new recording with no extracted brief.');
 assert.deepEqual(a.readWorkspace().draft.fields,originalFields);assert.doesNotMatch(a.storage.getItem(workspaceKey),/PRIVATE_SESSION/);
 const b=creator({storage:a.storage});assert.equal(b.element('description').value,'A new recording with no extracted brief.');
 assert.equal(b.element('speech-receipt').hidden,true);assert.equal(b.apiCalls(),0);
});

test('explicit edits to a shared world clear its fragment and recover the edited draft on reload',()=>{
 const original=creator();original.element('remember-draft').checked=true;original.element('remember-draft').handlers.change();
 const hash='#world='+sharing.encodeWorld({version:1,brief:{...brief,world:'Shared starting point'},analysis});
 const a=creator({storage:original.storage,hash});assert.equal(a.run('location.hash'),hash);
 a.element('brief-rules').value='  A partially revised rule\n';a.element('brief-rules').handlers.input();
 assert.equal(a.run('location.hash'),'');assert.equal(a.run('applied.brief.rules[0]'),brief.rules[0]);
 assert.equal(a.readWorkspace().draft.fields.rules,'  A partially revised rule\n');assert.equal(a.readWorkspace().draft.edited,true);
 const b=creator({storage:a.storage,hash:a.run('location.hash')});
 assert.equal(b.element('brief-world').value,'Shared starting point');assert.equal(b.element('brief-rules').value,'  A partially revised rule\n');
 assert.equal(b.run('applied'),null);assert.equal(b.element('applied-panel').hidden,true);assert.equal(b.apiCalls(),0);
});

test('another tab opting out prevents later local edits from resurrecting the draft before or after storage events',()=>{
 for(const deliverEvent of [false,true]){
  const a=creator();a.run('activate(bundle)');a.element('world-name').value='Keep this world';a.element('save-world').click();
  a.element('remember-draft').checked=true;a.element('remember-draft').handlers.change();
  a.element('description').value='Original recovery text';a.element('description').handlers.input();
  const otherTab=creator({storage:a.storage});otherTab.element('remember-draft').checked=false;otherTab.element('remember-draft').handlers.change();
  assert.equal(a.readWorkspace().draft,null);
  if(deliverEvent){a.dispatchStorage(workspaceKey);assert.equal(a.element('remember-draft').checked,false);}
  a.element('description').value='Keep only in this tab';a.element('description').handlers.input();
  assert.equal(a.readWorkspace().draft,null);assert.equal(a.readWorkspace().worlds[0].title,'Keep this world');
  assert.equal(a.run('rememberDraft'),false);assert.equal(a.element('remember-draft').checked,false);assert.equal(a.element('description').value,'Keep only in this tab');
  const reloaded=creator({storage:a.storage});assert.equal(reloaded.element('description').value,'');assert.equal(reloaded.readWorkspace().worlds.length,1);
 }
});

test('dictating a new version uses the shared capture and Dictation flow while preserving the applied world',async()=>{
 let resolveCapture,captureCalls=0,stopCalls=0,finishCallback;
 const captureReady=new Promise(resolve=>{resolveCapture=resolve;}),audio=new Uint8Array(8000).buffer;
 const newBrief={...brief,world:'A revised counting game'};
 const a=creator({captureFactory:(progress,finish)=>{captureCalls++;finishCallback=finish;progress(0.5,2);return captureReady;},requestHandler:async()=>({ok:true,json:async()=>({text:'My revised counting game.',brief:newBrief,structured:JSON.stringify(newBrief),receipt:{elapsedMs:900,endpoint:'https://dictation.assemblyai.com/transcribe',requestId:'test-request'}})})});
 a.run("showBrief(bundle.brief,'Original');activate(bundle);proposal={...bundle,brief:{...bundle.brief,world:'Pending model'}};controls()");
 const applied=a.run('JSON.stringify(applied)'),verdict=a.run('JSON.stringify(result)');
 assert.equal(a.element('record').handlers.click,a.run('beginRecording'));
 const recording=a.element('revise-by-voice').click();
 assert.equal(captureCalls,1);assert.equal(finishCallback,a.run('finishRecording'));assert.equal(a.run('starting'),true);assert.equal(a.element('record').disabled,true);
 resolveCapture({stop:async()=>{stopCalls++;return audio;}});await recording;
 assert.equal(a.element('record-label').textContent,'Finish recording');assert.equal(a.element('record').disabled,false);
 for(const id of ['revise-by-voice','sample','extract','description','brief-world','brief-rules','analyze','review-only','apply','save-world','remember-draft','import-world','share','export'])assert.equal(a.element(id).disabled,true,`${id} must be disabled during capture`);
 assert.equal(a.run('JSON.stringify(applied)'),applied);assert.equal(a.run('JSON.stringify(result)'),verdict);assert.equal(a.run('proposal.brief.world'),'Pending model');
 assert.equal(a.apiCalls(),0);
 await a.element('record').click();
 assert.equal(stopCalls,1);assert.equal(a.apiCalls(),1);assert.equal(a.requests[0].route,'/api/world/transcribe');assert.equal(a.requests[0].options.headers['Content-Type'],'audio/pcm');assert.equal(a.requests[0].options.body,audio);
 assert.equal(a.run('capture'),null);assert.equal(a.element('brief-world').value,newBrief.world);assert.equal(a.element('speech-original').textContent,'My revised counting game.');
 assert.equal(a.run('JSON.stringify(applied)'),applied);assert.equal(a.run('JSON.stringify(result)'),verdict);assert.equal(a.run('proposal'),null);assert.equal(a.element('apply').disabled,true);
 assert.equal(a.element('revise-by-voice').disabled,false);assert.equal(a.element('record').disabled,false);assert.equal(a.element('description').disabled,false);
});
