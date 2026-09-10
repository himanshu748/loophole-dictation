import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_POLICY,FIXED_POLICY,search,searchAll,replay,violation,initialState,transition,validatePolicy} from '../public/engine.js';
import {EXAMPLES,compileExample,validateCompilation} from '../public/compiler.js';

test('opening for blue permits a shortest three-move tailgate',()=>{
  const r=search(DEFAULT_POLICY);assert.equal(r.found,true);assert.deepEqual(r.trace.map(t=>[t.action.type,t.action.robot]),[['scan','B-01'],['enter','B-01'],['enter','R-02']]);assert.equal(violation(r.trace.at(-1).state),'R-02');
});
test('one robot per opening fixes the queue but not borrowed openings',()=>{
  const p=EXAMPLES[1].policy;assert.equal(search(p,'tailgate').found,false);assert.equal(search(p,'theft').found,true);
});
test('binding to the scanner stops pass theft but misses revocation',()=>{
  const p=EXAMPLES[2].policy;assert.equal(search(p,'theft').found,false);const r=search(p,'revoked');assert.equal(r.found,true);assert.deepEqual(r.trace.map(t=>t.action.type),['scan','revoke','enter']);
});
test('entry-time validity closes all three bounded experiments',()=>{
  for(const r of searchAll(FIXED_POLICY)){assert.equal(r.found,false);assert.equal(r.exhaustive,true);assert.ok(r.states>1);}
});
test('same counterexample replay preserves actions and blocks the red robot',()=>{
  const original=search(DEFAULT_POLICY).trace;const repaired=replay(original,FIXED_POLICY);
  assert.deepEqual(repaired.map(t=>t.action),original.map(t=>t.action));assert.equal(repaired[0].allowed,true);assert.equal(repaired[1].allowed,true);assert.equal(repaired[2].allowed,false);assert.equal(violation(repaired.at(-1).state),null);
});
test('the improved policy still lets a valid blue robot through',()=>{
  let s=initialState();s=transition(s,{type:'scan',robot:'B-01'},FIXED_POLICY).state;
  const r=transition(s,{type:'enter',robot:'B-01'},FIXED_POLICY);assert.equal(r.allowed,true);assert.deepEqual(r.state.inside,['B-01']);assert.equal(r.state.gate,false);
});
test('revocation is checked at entry, not merely at scan',()=>{
  let s=initialState();s=transition(s,{type:'scan',robot:'B-01'},FIXED_POLICY,'revoked').state;s=transition(s,{type:'revoke',robot:'B-01'},FIXED_POLICY,'revoked').state;
  assert.equal(transition(s,{type:'enter',robot:'B-01'},FIXED_POLICY,'revoked').allowed,false);
});
test('model transitions cannot mutate the input state',()=>{
  const s=initialState(), copy=structuredClone(s);transition(s,{type:'scan',robot:'B-01'},DEFAULT_POLICY);assert.deepEqual(s,copy);
});
test('invalid policies and scenarios are rejected',()=>{
  for(const p of [null,{}, {trigger:'green',passage:'shared',recheck:false},{...FIXED_POLICY,recheck:'true'},{...FIXED_POLICY,timer:30}]) assert.throws(()=>validatePolicy(p));assert.throws(()=>search(FIXED_POLICY,'unknown'));
});
test('unknown wording never accidentally matches an example',()=>{
  assert.equal(compileExample('Do not open the gate when a robot with a blue badge arrives.'),null);assert.equal(compileExample(EXAMPLES[0].text+' Except after midnight.'),null);assert.equal(compileExample(EXAMPLES[0].text).source,'example');
});
test('unsupported interpretations and malformed assumptions are rejected',()=>{
  assert.throws(()=>validateCompilation({supported:false,reason:'Cannot model time',policy:DEFAULT_POLICY,assumptions:[]}));assert.throws(()=>validateCompilation({supported:true,policy:DEFAULT_POLICY,assumptions:'bad'}));
});
test('all policy combinations produce reproducible valid counterexamples',()=>{
  for(const trigger of ['blue','red','any'])for(const passage of ['shared','single','bound'])for(const recheck of [false,true])for(const scenario of ['tailgate','theft','revoked']){
    const p={trigger,passage,recheck},r=search(p,scenario);assert.ok(r.states<100);
    if(r.found){const trace=replay(r.trace,p,scenario);assert.ok(trace.every(t=>t.allowed));assert.ok(violation(trace.at(-1).state));assert.deepEqual(trace,r.trace);}else assert.equal(r.exhaustive,true);
  }
});
test('red badge cannot open a blue-triggered gate; blocked action preserves state',()=>{
  const s=initialState(),r=transition(s,{type:'scan',robot:'R-02'},DEFAULT_POLICY);assert.equal(r.allowed,false);assert.deepEqual(r.state,s);
});
