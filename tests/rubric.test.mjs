import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultRubric,validateRubric,rubricText,rubricFields} from '../public/rubric.js';
import {DOMAINS,domainSearch,domainSearchAll,domainReplay} from '../public/domains.js';
import {search,searchAll,replay,violation,DEFAULT_POLICY} from '../public/engine.js';
import {shareQuery,readSharedRule} from '../public/rules.js';
test('a coupon rubric changes success independently of the applied policy',()=>{
  const p=DOMAINS.coupons.starter;
  const r={name:'Two-use offer',newOnly:false,perCustomer:2,perOrder:1};
  assert.equal(domainSearch('coupons',p,'repeat').found,true);
  assert.equal(domainSearch('coupons',p,'repeat',r).found,false);
  assert.equal(domainSearch('coupons',p,'repeat',{...r,perCustomer:1}).found,true);
  const unlimited={eligibility:'any',limit:'none',recheck:false};
  assert.match(domainSearch('coupons',unlimited,'repeat',{...r,perCustomer:0}).trace.at(-1).state.breach,/same order/);
  assert.equal(domainSearch('coupons',unlimited,'existing',r).found,true); // second redemption exceeds per-order cap
  assert.equal(domainSearch('coupons',{...unlimited,limit:'order'},'existing',r).found,false);
});
test('approval criteria can be selected independently without modifying publication permissions',()=>{
  const p={reviewer:'any',binding:'document',recheck:false};
  const r={name:'Independent review only',independent:true,currentVersion:false,activeApproval:false};
  assert.equal(domainSearch('approvals',p,'self',r).found,true);
  assert.equal(domainSearch('approvals',p,'edited',r).found,false);
  assert.equal(domainSearch('approvals',p,'withdrawn',r).found,false);
  assert.equal(domainSearch('approvals',p,'edited',{...r,currentVersion:true}).found,true);
  assert.equal(domainSearch('approvals',p,'withdrawn',{...r,activeApproval:true}).found,true);
  const old=domainSearch('approvals',p,'edited');
  const changed=domainReplay('approvals',old.trace,p,'edited',r);
  assert.ok(changed.every(s=>s.allowed));assert.equal(changed.at(-1).state.published,true);assert.equal(changed.at(-1).state.breach,null);
});
test('checkpoint rubric supports colors, revocation and capacity independently',()=>{
  const r={name:'Either color, active badge',badge:'any',unrevoked:true,capacity:2};
  assert.equal(search(DEFAULT_POLICY,'tailgate',r).found,false);
  assert.equal(search(DEFAULT_POLICY,'tailgate',{...r,capacity:1}).found,true);
  assert.equal(search(DEFAULT_POLICY,'revoked',r).found,true);
  const redPolicy={trigger:'red',passage:'bound',recheck:true};
  assert.equal(search(redPolicy,'theft',{...r,badge:'red'}).found,false);
  assert.equal(search(redPolicy,'theft').found,true);
});
test('custom rubric sharing validates and round-trips names and criteria',()=>{
  const rubric={name:'Red badges & one robot',badge:'red',unrevoked:false,capacity:1};
  const shared=readSharedRule(shareQuery(DEFAULT_POLICY,'theft',rubric));
  assert.deepEqual(shared.rubric,rubric);
  assert.deepEqual(searchAll(shared.policy,shared.rubric),searchAll(DEFAULT_POLICY,rubric));
  assert.deepEqual(readSharedRule('rule=blue.shared.0').rubric,defaultRubric('checkpoint'));
  assert.throws(()=>readSharedRule('rule=blue.shared.0&rubric=null'));
});
test('malformed and empty rubrics are rejected rather than producing a vacuous pass',()=>{
  for(const world of ['coupons','approvals','checkpoint']){
    const r=defaultRubric(world);
    for(const bad of [null,[],{...r,name:''},{...r,name:'a'.repeat(81)},{...r,arbitrary:true}])assert.throws(()=>validateRubric(world,bad));
    assert.ok(rubricText(world,r).length>10);
  }
  assert.throws(()=>validateRubric('coupons',{name:'None',newOnly:false,perCustomer:0,perOrder:0}));
  assert.throws(()=>validateRubric('approvals',{name:'None',independent:false,currentVersion:false,activeApproval:false}));
  assert.throws(()=>validateRubric('checkpoint',{name:'None',badge:'any',unrevoked:false,capacity:2}));
  assert.throws(()=>validateRubric('coupons',{...defaultRubric('coupons'),perCustomer:'2'}));
  assert.throws(()=>validateRubric('constructor',{}));
});
test('every supported rubric yields replayable counterexamples or exhaustive results',()=>{
  let combinations=0;
  for(const world of ['coupons','approvals','checkpoint']){
    let candidates=[{name:'Matrix rubric'}];
    for(const f of rubricFields(world))candidates=candidates.flatMap(r=>Object.keys(f.options).map(value=>({...r,[f.key]:f.type==='boolean'?value==='true':f.type==='number'?Number(value):value})));
    let policies=world==='checkpoint'?[{trigger:'any',passage:'shared',recheck:false},DEFAULT_POLICY]:[DOMAINS[world].starter,DOMAINS[world].fixed];
    for(const candidate of candidates){
      let rubric;try{rubric=validateRubric(world,candidate);}catch{continue;}
      for(const p of policies){
        const results=world==='checkpoint'?searchAll(p,rubric):domainSearchAll(world,p,rubric);
        for(const r of results){
          combinations++;assert.deepEqual(r.rubric,rubric);
          if(r.found){
            const moves=world==='checkpoint'?replay(r.trace,p,r.scenario,rubric):domainReplay(world,r.trace,p,r.scenario,rubric);
            assert.deepEqual(moves,r.trace);assert.ok(moves.every(m=>m.allowed));
            assert.ok(world==='checkpoint'?violation(moves.at(-1).state,rubric):moves.at(-1).state.breach);
          }else assert.equal(r.exhaustive,true);
        }
      }
    }
  }
  assert.equal(combinations,198);
});
