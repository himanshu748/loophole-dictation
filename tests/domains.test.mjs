import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMAINS,domainSearch,domainSearchAll,domainReplay,domainInitial,domainStep,domainText,validateDomainPolicy,domainActions} from '../public/domains.js';
import {compileExample,validateCompilation} from '../public/compiler.js';
const act=(type,other={})=>({type,...other});
function play(id,policy,scenario,actions){return domainReplay(id,actions.map(action=>({action})),policy,scenario);}
test('a coupon reserved on two orders can be redeemed twice with the starter, but not the repair',()=>{
  const actions=[act('apply',{order:0}),act('apply',{order:1}),act('redeem',{order:0}),act('redeem',{order:1})];
  const loose=play('coupons',DOMAINS.coupons.starter,'repeat',actions);
  assert.ok(loose.every(x=>x.allowed));assert.match(loose.at(-1).state.breach,/more than once/);
  const fixed=play('coupons',DOMAINS.coupons.fixed,'repeat',actions);
  assert.equal(fixed.at(-1).allowed,false);assert.equal(fixed.at(-1).state.breach,null);
});
test('single-customer limit alone does not recheck changed eligibility',()=>{
  const actions=[act('apply',{order:0}),act('purchase'),act('redeem',{order:0})];
  const p={...DOMAINS.coupons.fixed,recheck:false};
  assert.match(play('coupons',p,'changed',actions).at(-1).state.breach,/existing customer/);
  assert.equal(play('coupons',DOMAINS.coupons.fixed,'changed',actions).at(-1).allowed,false);
});
test('approval for version 1 cannot safely publish a changed version',()=>{
  const actions=[act('approve',{actor:'reviewer'}),act('edit'),act('publish')];
  assert.match(play('approvals',DOMAINS.approvals.starter,'edited',actions).at(-1).state.breach,/unreviewed version/);
  assert.equal(play('approvals',DOMAINS.approvals.fixed,'edited',actions).at(-1).allowed,false);
});
test('independent approval and current approval are separate requirements',()=>{
  assert.match(play('approvals',{...DOMAINS.approvals.fixed,reviewer:'any'},'self',[act('approve',{actor:'author'}),act('publish')]).at(-1).state.breach,/independent review/);
  const actions=[act('approve',{actor:'reviewer'}),act('withdraw'),act('publish')];
  assert.match(play('approvals',{...DOMAINS.approvals.fixed,recheck:false},'withdrawn',actions).at(-1).state.breach,/withdrawn/);
  assert.equal(play('approvals',DOMAINS.approvals.fixed,'withdrawn',actions).at(-1).allowed,false);
});
test('valid workflows still complete under the strongest policies',()=>{
  assert.equal(play('coupons',DOMAINS.coupons.fixed,'repeat',[act('apply',{order:0}),act('redeem',{order:0})]).at(-1).allowed,true);
  const review=play('approvals',DOMAINS.approvals.fixed,'edited',[act('edit'),act('approve',{actor:'reviewer'}),act('publish')]).at(-1);
  assert.equal(review.allowed,true);assert.equal(review.state.breach,null);assert.equal(review.state.published,true);
});
test('all model combinations yield replayable counterexamples or exhaustive results',()=>{
  let count=0;
  for(const [id,d] of Object.entries(DOMAINS)) {
    let policies=[{}];
    for(const f of d.fields)policies=policies.flatMap(p=>Object.keys(f.options).map(v=>({...p,[f.key]:f.key==='recheck'?v==='true':v})));
    for(const p of policies)for(const r of domainSearchAll(id,p)) {
      count++;assert.ok(r.states>0&&r.states<5000);
      if(r.found){const replay=domainReplay(id,r.trace,p,r.scenario);assert.ok(replay.every(x=>x.allowed));assert.ok(replay.at(-1).state.breach);assert.ok(replay.slice(0,-1).every(x=>!x.state.breach));assert.deepEqual(replay,r.trace);}
      else assert.equal(r.exhaustive,true);
    }
    assert.ok(domainSearchAll(id,d.fixed).every(r=>!r.found));
    for(const p of [d.starter,d.fixed])assert.deepEqual(compileExample(domainText(id,p),id).policy,p);
  }
  assert.equal(count,60);
});
test('schemas reject unknown fields, wrong booleans, cross-world policies and unsupported clauses',()=>{
  assert.throws(()=>validateDomainPolicy('coupons',{...DOMAINS.coupons.fixed,deadline:3}));
  assert.throws(()=>validateDomainPolicy('coupons',{...DOMAINS.coupons.fixed,recheck:'true'}));
  assert.throws(()=>validateDomainPolicy('coupons',DOMAINS.approvals.fixed));
  assert.throws(()=>validateCompilation({supported:false,reason:'Deadlines are outside this model.'},'approvals'),/Deadlines/);
  assert.throws(()=>domainSearch('coupons',DOMAINS.coupons.fixed,'constructor'));
  assert.equal(domainStep('approvals',domainInitial('approvals'),act('edit'),DOMAINS.approvals.fixed,'self').allowed,false);
});
