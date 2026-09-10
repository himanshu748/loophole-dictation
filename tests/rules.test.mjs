import test from 'node:test';import assert from 'node:assert/strict';
import {shareQuery,readSharedRule,policyText} from '../public/rules.js';
import {searchAll} from '../public/engine.js';
test('shared custom rules preserve every supported behavior in every experiment',()=>{
 for(const trigger of ['blue','red','any'])for(const passage of ['shared','single','bound'])for(const recheck of [false,true])for(const scenario of ['tailgate','theft','revoked']){
 const policy={trigger,passage,recheck},shared=readSharedRule(shareQuery(policy,scenario));assert.deepEqual(shared.policy,policy);assert.equal(shared.scenario,scenario);assert.deepEqual(searchAll(shared.policy),searchAll(policy));assert.equal(shared.text,policyText(policy));}
});
test('invalid shared rules are rejected instead of partially applied',()=>{for(const q of ['rule=blue.bound.2','rule=blue.bound.1.extra','rule=green.shared.0','rule=blue.single.0&experiment=unknown'])assert.throws(()=>readSharedRule(q));assert.equal(readSharedRule('challenge=tailgate'),null);});
