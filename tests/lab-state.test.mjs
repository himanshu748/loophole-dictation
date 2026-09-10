import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as model from '../public/domains.js';
import * as rubrics from '../public/rubric.js';
// Execute the real UI state controller with a minimal DOM, not a duplicate controller.
// Browser checks separately cover actual controls, focus and layout.
function lab(search='?world=approvals') {
  let shared='',exported=null;
  class TestURL extends URL {static createObjectURL(blob){exported=blob;return 'blob:test';}static revokeObjectURL(){}}
  const nodes=new Map();
  function element(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},querySelectorAll(){return [];},setAttribute(){},focus(){},scrollIntoView(){}});return nodes.get(id);}
  const context=vm.createContext({...model,...rubrics,mountRubricEditor(){},URLSearchParams,URL:TestURL,Blob,setTimeout(){},navigator:{clipboard:{async writeText(text){shared=text;}}},structuredClone,location:{search,origin:'http://localhost'},document:{createElement:()=>({click(){}}),getElementById:element,querySelector:()=>element('tab'),querySelectorAll:()=>[]},window:{addEventListener(){}},matchMedia:()=>({matches:false})});
  vm.runInContext(readFileSync(new URL('../public/lab.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  return {element,shared:()=>shared,exported:()=>exported,run:code=>vm.runInContext(code,context)};
}
test('a manually discovered loophole survives repair with the same action trace',async()=>{
  const {element,run}=lab();
  run("manualMove({type:'approve',actor:'reviewer'});manualMove({type:'edit'});manualMove({type:'publish'});");
  assert.match(element('result').innerHTML,/You found a loophole/);
  const actions=run('JSON.stringify(trace.map(t=>t.action))');
  await element('fixed').handlers.click();await element('primary').handlers.click();
  assert.equal(run('original.source'),'manual');
  assert.equal(run('JSON.stringify(trace.map(t=>t.action))'),actions);
  assert.equal(run('trace.at(-1).allowed'),false);
  assert.equal(element('playback').hidden,false);
});
test('replaying the original after a valid manual run refreshes summary and export state',async()=>{
  const {element,run}=lab();run('run()');
  await element('fixed').handlers.click();await element('primary').handlers.click();
  await element('manual-reset').handlers.click();
  run("manualMove({type:'edit'});manualMove({type:'approve',actor:'reviewer'});manualMove({type:'publish'});");
  assert.match(element('result').innerHTML,/Version 2 is published/);
  await element('replay-original').handlers.click();
  assert.doesNotMatch(element('result').innerHTML,/Version 2 is published/);
  assert.equal(run('result.found'),false);assert.equal(run('manual'),false);
  assert.equal(run('trace.at(-1).allowed'),false);assert.equal(run('trace.at(-1).state.published'),false);
  assert.equal(element('export').disabled,false);
});
test('export provenance follows the applied speech, not a later draft',async()=>{
  const {element,run}=lab();
  run("speech={text:'Original voice rule',cleaned:'Cleaned voice rule'};pending={policy:{...domain.fixed}};");
  element('rule').value='Cleaned voice rule';await element('primary').handlers.click();
  run("speech={text:'Different draft',cleaned:'Different draft'};");
  assert.equal(run('appliedSpeech.text'),'Original voice rule');
});
test('applying a new rubric recalculates results and clears the old counterexample without applying a rule draft',()=>{
  const {element,run}=lab();run('run()');
  assert.equal(run('result.found'),true);
  const originalPolicy=run('JSON.stringify(policy)');
  element('rule').value='Unapplied rule draft';
  run("applyRubric({name:'Independent review only',independent:true,currentVersion:false,activeApproval:false})");
  assert.equal(run('result.found'),false);assert.equal(run('original'),null);assert.equal(run('trace.length'),0);
  assert.equal(run('JSON.stringify(policy)'),originalPolicy);
  assert.equal(element('rule').value,'Unapplied rule draft');
  assert.match(element('result').innerHTML,/Independent review only/);
  assert.equal(run('result.rubric.currentVersion'),false);
});
test('actual share handler preserves applied rubric on reload and leaves drafts out',async()=>{
  const first=lab('?world=coupons');
  first.run("applyRubric({name:'Two-use offer',newOnly:false,perCustomer:2,perOrder:1})");
  first.element('rule').value='Unapplied text';
  await first.element('share').handlers.click();
  const url=new URL(first.shared());
  const reopened=lab(url.search);reopened.run('run()');
  assert.equal(reopened.run('rubric.name'),'Two-use offer');
  assert.equal(reopened.run('result.found'),false);
  assert.equal(reopened.run('policy.limit'),'order');
  assert.notEqual(reopened.element('rule').value,'Unapplied text');
});
test('actual export handler includes the applied rubric in the goal and every search result',async()=>{
  const app=lab();app.run("applyRubric({name:'Independent review only',independent:true,currentVersion:false,activeApproval:false})");
  await app.element('export').handlers.click();
  const exported=JSON.parse(await app.exported().text());
  assert.equal(exported.version,3);assert.equal(exported.rubric.name,'Independent review only');
  assert.equal(exported.goal,'Publish only with an independent review.');
  assert.deepEqual(exported.result.rubric,exported.rubric);
  assert.ok(exported.allResults.every(r=>JSON.stringify(r.rubric)===JSON.stringify(exported.rubric)));
  assert.equal(exported.original,null);
});
