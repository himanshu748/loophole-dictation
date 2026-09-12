import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace,readWorkspace,writeWorkspace,parseWorldImport,addSavedWorld,removeSavedWorld} from '../public/world-workspace.js';

const KEY='loophole.workspace.v1',now='2026-09-12T09:00:00.000Z';
const brief={world:'A community kitchen',actors:['Cook'],resources:['Meals'],rules:['A cook may serve a meal.'],rubric:['Every visitor should have a meal.']};
const analysis={mode:'review',explanation:'The number of meals is unspecified.',assessments:[{rubricIndex:0,status:'needs_clarification',scenario:'Visitors may arrive after food runs out.',reasoning:'The rule permits serving but gives no capacity.',suggestedRevision:'Define a meal capacity and fallback.'}]};
const bundle=()=>({version:1,brief:structuredClone(brief),analysis:structuredClone(analysis)});
function storage(initial=null){
  let value=initial;
  return {getItem(key){assert.equal(key,KEY);return value;},setItem(key,text){assert.equal(key,KEY);value=text;},raw(){return value;}};
}

test('missing storage returns a fresh empty workspace and unavailable storage has an actionable error',()=>{
  assert.deepEqual(readWorkspace(storage()),emptyWorkspace());
  const a=emptyWorkspace();a.worlds.push('unrelated');assert.deepEqual(emptyWorkspace().worlds,[]);
  assert.throws(()=>readWorkspace(null),/storage is unavailable/);
  assert.throws(()=>readWorkspace({getItem(){throw new Error('blocked');}}),/export your evidence/);
});

test('corrupt, unsupported, or invalid stored workspaces never overwrite the original data',()=>{
  for(const raw of ['{broken',JSON.stringify({version:2,draft:null,worlds:[]}),JSON.stringify({version:1,draft:{},worlds:[]})]){
    const store=storage(raw);
    assert.throws(()=>readWorkspace(store),/could not be loaded/);
    assert.equal(store.raw(),raw);
  }
});

test('draft persistence preserves incomplete raw fields and whitespace without validating them as a completed brief',()=>{
  const draft={description:'  unfinished idea\n',fields:{world:'',actors:'Chef\n\n  Guest ',resources:'',rules:'\n',rubric:'Something I have not decided\n'},source:null,edited:true};
  const store=storage(),result=writeWorkspace(store,{...emptyWorkspace(),draft});
  assert.deepEqual(result.draft,draft);
  assert.deepEqual(readWorkspace(store).draft,draft);
  draft.fields.actors='Later mutation';
  assert.notEqual(result.draft.fields.actors,draft.fields.actors);
});

test('saved worlds and imports discard transcripts, provider receipts, and cached verdicts',()=>{
  const dirty={...bundle(),speech:{text:'PRIVATE TRANSCRIPT'},receipt:{session_id:'PRIVATE SESSION'},result:{found:true},source:'PRIVATE SOURCE'};
  const evidence={product:'Loophole',format:'custom-world',version:1,applied:dirty,displayedTrace:['PRIVATE TRACE'],result:{found:true}};
  assert.deepEqual(parseWorldImport(JSON.stringify(evidence)),bundle());
  assert.deepEqual(parseWorldImport(JSON.stringify(dirty)),bundle());
  const workspace=addSavedWorld(emptyWorkspace(),dirty,{id:'kitchen',now});
  const store=storage();writeWorkspace(store,workspace);
  assert.doesNotMatch(store.raw(),/PRIVATE|receipt|speech|result|displayedTrace/);
  assert.deepEqual(readWorkspace(store).worlds[0].bundle,bundle());
});

test('large evidence envelopes import only the applied bundle and keep comparison data out of saved storage',()=>{
  const previous=bundle();
  previous.brief.rubric=Array.from({length:12},(_,i)=>`Earlier requirement ${i}`);
  previous.analysis.assessments=previous.brief.rubric.map((_,rubricIndex)=>({rubricIndex,status:'potential_gap',scenario:'界'.repeat(1800),reasoning:'界'.repeat(1800),suggestedRevision:'界'.repeat(1000)}));
  const evidence={product:'Loophole',format:'custom-world',version:1,applied:bundle(),comparisonPrevious:previous,comparison:{before:{mode:'review',assessments:previous.analysis.assessments},after:{mode:'review',assessments:analysis.assessments}},displayedTrace:[],result:null};
  const serialized=JSON.stringify(evidence),size=new TextEncoder().encode(serialized).length;
  assert.ok(size>200000&&size<1000000);
  const imported=parseWorldImport(serialized);
  assert.deepEqual(imported,bundle());
  const store=storage();
  writeWorkspace(store,addSavedWorld(emptyWorkspace(),imported,{id:'large-report',now}));
  assert.deepEqual(readWorkspace(store).worlds[0].bundle,bundle());
  assert.doesNotMatch(store.raw(),/comparisonPrevious|comparison|Earlier requirement|界|displayedTrace/);
  assert.ok(new TextEncoder().encode(store.raw()).length<200000);
});

test('import rejects malformed, unsupported, incomplete, and executable-looking data',()=>{
  for(const value of ['', 'not json', 'null', '[]',JSON.stringify({...bundle(),version:2}),JSON.stringify({...bundle(),brief:{...brief,rubric:[]}}),JSON.stringify({...bundle(),analysis:{...analysis,run:'alert(1)'}}),JSON.stringify({version:1,format:'preset',applied:bundle()})]){
    assert.throws(()=>parseWorldImport(value));
  }
  assert.throws(()=>parseWorldImport('globalThis.__worldImportExecuted=true'),/not valid JSON/);
  assert.equal(globalThis.__worldImportExecuted,undefined);
  assert.throws(()=>parseWorldImport(JSON.stringify({...bundle(),padding:'x'.repeat(1000000)})),/1 MB/);
  const oversizedUnicode=JSON.stringify({...bundle(),padding:'🧪'.repeat(251000)});
  assert.ok(oversizedUnicode.length<1000000);
  assert.throws(()=>parseWorldImport(oversizedUnicode),/1 MB/);
});

test('the import byte limit includes a valid file of exactly one million bytes',()=>{
  const input={...bundle(),padding:''};
  input.padding='x'.repeat(1000000-new TextEncoder().encode(JSON.stringify(input)).length);
  const exact=JSON.stringify(input);
  assert.equal(new TextEncoder().encode(exact).length,1000000);
  assert.deepEqual(parseWorldImport(exact),bundle());
  assert.throws(()=>parseWorldImport(exact+' '),/1 MB/);
});

test('saving updates the same ID without duplicates or losing the other worlds and does not mutate input',()=>{
  let workspace=addSavedWorld(emptyWorkspace(),bundle(),{id:'first',title:'First',now});
  workspace=addSavedWorld(workspace,bundle(),{id:'second',title:'Second',now});
  const before=structuredClone(workspace),next=addSavedWorld(workspace,bundle(),{id:'first',title:'Updated title',now:'2026-09-13T09:00:00Z'});
  assert.deepEqual(workspace,before);
  assert.deepEqual(next.worlds.map(w=>w.id),['first','second']);
  assert.equal(next.worlds[0].title,'Updated title');
  assert.equal(next.worlds[0].updatedAt,'2026-09-13T09:00:00.000Z');
  assert.equal(addSavedWorld(next,bundle(),{id:'first',now}).worlds[0].title,'Updated title');
  assert.deepEqual(removeSavedWorld(next,'first').worlds.map(w=>w.id),['second']);
  assert.deepEqual(removeSavedWorld(next,'absent'),next);
});

test('eight-world limit permits replacing a world but rejects silent eviction and invalid metadata',()=>{
  let workspace=emptyWorkspace();
  for(let i=0;i<8;i++)workspace=addSavedWorld(workspace,bundle(),{id:`world-${i}`,now});
  assert.throws(()=>addSavedWorld(workspace,bundle(),{id:'ninth',now}),/at most 8/);
  assert.equal(addSavedWorld(workspace,bundle(),{id:'world-0',now}).worlds.length,8);
  for(const options of [{id:'__proto__'},{id:'bad/id'},{title:' '},{title:'x'.repeat(121)},{now:'not a date'}])assert.throws(()=>addSavedWorld(emptyWorkspace(),bundle(),options));
  assert.equal(addSavedWorld(emptyWorkspace(),bundle()).worlds.length,1);
});

test('raw field and stored byte limits reject excessive content before changing storage',()=>{
  const store=storage(),fields={world:'',actors:'',resources:'',rules:'',rubric:''};
  assert.throws(()=>writeWorkspace(store,{...emptyWorkspace(),draft:{description:'',fields:{...fields,rubric:'x'.repeat(16001)},source:null,edited:true}}),/at most 16,000/);
  assert.equal(store.raw(),null);
  assert.throws(()=>readWorkspace(storage(' '.repeat(400001))),/400 KB/);
  const large=bundle();large.brief.rubric=Array.from({length:12},(_,i)=>`Requirement ${i}`);
  large.analysis.assessments=large.brief.rubric.map((_,rubricIndex)=>({rubricIndex,status:'potential_gap',scenario:'界'.repeat(1800),reasoning:'界'.repeat(1800),suggestedRevision:'界'.repeat(1000)}));
  let workspace=addSavedWorld(emptyWorkspace(),large,{id:'one',now});
  workspace=addSavedWorld(workspace,large,{id:'two',now});
  assert.throws(()=>addSavedWorld(workspace,large,{id:'three',now}),/exceeds 400 KB/);
});

test('quota and blocked write failures explain how to preserve the session',()=>{
  assert.throws(()=>writeWorkspace({setItem(){throw Object.assign(new Error(),{name:'QuotaExceededError'});}},emptyWorkspace()),/storage is full.*export your evidence/);
  assert.throws(()=>writeWorkspace(null,emptyWorkspace()),/changes remain in this tab/);
  assert.throws(()=>writeWorkspace({setItem(){throw new Error('disabled');}},emptyWorkspace()),/storage is unavailable/);
});
