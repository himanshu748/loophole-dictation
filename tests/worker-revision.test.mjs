import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {validateWorldRevision} from '../world-services.mjs';

const brief={world:'A counting game',actors:['Player'],resources:['Tokens'],rules:['Take one token at a time.'],rubric:['Hold at most one token.']};
const audio=Buffer.alloc(8000).toString('base64');
const edit={field:'rules',operation:'replace',item_number:1};
const request=(body,headers={})=>new Request('https://loophole.example/api/world/revise',{method:'POST',headers:{'X-Loophole-Client':'web','Content-Type':'application/json',...headers},body});

function harness(){
 const budgetCalls=[],revisionCalls=[];let budgetWrites=0;
 class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
 const context=vm.createContext({DurableObject,validateWorldRevision,URL,Response,Uint8Array,TextDecoder,Date,JSON,Error,SyntaxError,reviseWorld:async(pcm,brief,env,edit)=>{revisionCalls.push({pcm,brief,env,edit});return {text:'Revised rule',brief};},transcribe:async()=>{throw new Error('Wrong provider route');}});
 const source=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class VoiceBudget','class VoiceBudget').replace('export default {','const worker = {');
 vm.runInContext(source,context);
 const env={ASSEMBLYAI_API_KEY:'test-key',DAILY_API_LIMIT:'10',VOICE_BUDGET:{getByName(name){assert.equal(name,'public-demo-v1');return {async call(...args){budgetCalls.push(args);return {status:200,data:{revised:true}};}};}}};
 const ctx={storage:{async transaction(fn){return fn({get:async()=>null,put:async()=>{budgetWrites++;}});}}};
 return {worker:vm.runInContext('worker',context),Budget:vm.runInContext('VoiceBudget',context),env,ctx,budgetCalls,revisionCalls,budgetWrites:()=>budgetWrites};
}

test('Worker rejects invalid revision payloads and oversize bodies before invoking its budget object',async()=>{
 const h=harness();
 const cases=[
  [request('{}',{'Content-Type':'text/plain'}),415],
  [request('{broken'),400],
  [request('null'),400],
  [request(JSON.stringify({audio:'not base64!',brief,edit})),400],
  [request(JSON.stringify({audio:'AAAA',brief,edit})),400],
  [request(JSON.stringify({audio,brief:{...brief,rules:[]},edit})),400],
  [request(JSON.stringify({audio,brief:{...brief,rubric:[]},edit})),400],
  [request(JSON.stringify({audio,brief})),400],
  [request(JSON.stringify({audio,brief,edit:{...edit,item_number:2}})),400],
  [request(JSON.stringify({audio,brief,edit:{...edit,field:'actors'}})),400],
  [request(JSON.stringify({audio,brief,edit:{...edit,operation:'remove'}})),400],
  [request(JSON.stringify({audio:'A'.repeat(2600001),brief,edit})),413],
 ];
 for(const [req,status] of cases){const response=await h.worker.fetch(req,h.env);assert.equal(response.status,status,await response.text());}
 assert.equal(h.budgetCalls.length,0);assert.equal(h.revisionCalls.length,0);
});

test('Worker sends validated PCM, reviewed brief, and selected edit through the existing budget gate',async()=>{
 const h=harness(),response=await h.worker.fetch(request(JSON.stringify({audio,brief:{...brief,world:'  A counting game  '},edit}),{'Content-Type':'application/json; charset=utf-8','CF-Connecting-IP':'192.0.2.1'}),h.env);
 assert.equal(response.status,200);assert.equal(h.budgetCalls.length,1);
 const [kind,payload,ip]=h.budgetCalls[0];assert.equal(kind,'world-revise');assert.equal(ip,'192.0.2.1');
 assert.deepEqual(Object.keys(payload).sort(),['brief','edit','pcm']);assert.ok(payload.pcm instanceof Uint8Array);assert.equal(payload.pcm.length,8000);assert.deepEqual(payload.brief,brief);assert.deepEqual(payload.edit,edit);
 const missingKey=await h.worker.fetch(request(JSON.stringify({audio,brief,edit})),{...h.env,ASSEMBLYAI_API_KEY:''});assert.equal(missingKey.status,503);assert.equal(h.budgetCalls.length,1);
 const crossOrigin=await h.worker.fetch(request('{}',{Origin:'https://other.example'}),h.env);assert.equal(crossOrigin.status,403);assert.equal(h.budgetCalls.length,1);
});

test('VoiceBudget executes a contextual revision with its environment after charging the existing quota',async()=>{
 const h=harness(),budget=new h.Budget(h.ctx,h.env),payload=validateWorldRevision({audio,brief,edit});
 const result=await budget.call('world-revise',payload,'192.0.2.1');
 assert.equal(result.status,200);assert.equal(h.budgetWrites(),1);assert.equal(h.revisionCalls.length,1);
 assert.equal(h.revisionCalls[0].pcm,payload.pcm);assert.equal(h.revisionCalls[0].brief,payload.brief);assert.equal(h.revisionCalls[0].env,h.env);assert.equal(h.revisionCalls[0].edit,payload.edit);assert.deepEqual(h.revisionCalls[0].edit,edit);assert.equal(budget.active,0);
 const exhausted=new h.Budget(h.ctx,{...h.env,DAILY_API_LIMIT:'0'}),denied=await exhausted.call('world-revise',payload,'192.0.2.1');
 assert.equal(denied.status,429);assert.equal(h.revisionCalls.length,1);assert.equal(h.budgetWrites(),1);assert.equal(exhausted.active,0);
});
