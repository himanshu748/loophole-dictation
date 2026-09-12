import test from 'node:test';
import assert from 'node:assert/strict';
import {server} from '../server.mjs';
let base;
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
test('page and app modules are served with explicit MIME types',async()=>{for(const [file,type] of [['/','text/html'],['/app.js','text/javascript'],['/style.css','text/css']]){const r=await fetch(base+file);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').startsWith(type));}});
test('built-in rules work without credentials and expose their source',async()=>{const r=await fetch(base+'/api/compile',{method:'POST',headers:{'Content-Type':'application/json','X-Loophole-Client':'web'},body:JSON.stringify({text:'Open the gate when a robot with a blue badge arrives.'})});const data=await r.json();assert.equal(r.status,200);assert.equal(data.source,'example');assert.equal(data.policy.passage,'shared');});
test('cross-origin mutation and missing application headers are rejected',async()=>{const r=await fetch(base+'/api/compile',{method:'POST',headers:{Origin:'https://example.com','X-Loophole-Client':'web'},body:'{}'});assert.equal(r.status,403);const missing=await fetch(base+'/api/compile',{method:'POST',body:'{}'});assert.equal(missing.status,403);});
test('private files are not served',async()=>{for(const p of ['/.env','/server.mjs','/work/assembly-probe.json','/package.json'])assert.equal((await fetch(base+p)).status,404);});
test('malformed and excessive text are rejected before the provider call',async()=>{for(const body of ['null','{broken',JSON.stringify({text:'x'.repeat(2001)}),JSON.stringify({text:''}),JSON.stringify({text:'A rule',domain:'unknown'})]){const r=await fetch(base+'/api/compile',{method:'POST',headers:{'X-Loophole-Client':'web','Content-Type':'application/json'},body});assert.equal(r.status,400);}});
test('new worlds and domain-specific examples work without provider credentials',async()=>{const {DOMAINS,domainText}=await import('../public/domains.js');assert.equal((await fetch(base+'/lab?world=coupons')).status,200);for(const [domain,d] of Object.entries(DOMAINS)){const r=await fetch(base+'/api/compile',{method:'POST',headers:{'Content-Type':'application/json','X-Loophole-Client':'web'},body:JSON.stringify({domain,text:domainText(domain,d.fixed)})});assert.equal(r.status,200);assert.deepEqual((await r.json()).policy,d.fixed);}});
test('health reveals configuration availability, never keys',async()=>{const r=await fetch(base+'/api/health');const data=await r.json();assert.equal(typeof data.speechConfigured,'boolean');assert.equal(Object.keys(data).some(k=>k.toLowerCase().includes('key')),false);});
test('world creation routes validate input before spending provider budget',async()=>{assert.equal((await fetch(base+'/create')).status,200);for(const [route,body] of [['interpret','null'],['interpret',JSON.stringify({text:'x'.repeat(6001)})],['analyze','{}'],['analyze',JSON.stringify({brief:{world:'A world',actors:[],resources:[],rules:['Move'],rubric:['Stay safe']},reviewOnly:'yes'})],['analyze',JSON.stringify({brief:{world:'A world',actors:[],resources:[],rules:[],rubric:[]}})]]){const r=await fetch(base+'/api/world/'+route,{method:'POST',headers:{'X-Loophole-Client':'web','Content-Type':'application/json'},body});assert.equal(r.status,400);}});

test('contextual voice revision validates content type, audio, and the complete brief before provider access',async()=>{
 const brief={world:'A counting game',actors:['Player'],resources:['Tokens'],rules:['Take one token at a time.'],rubric:['Hold at most one token.']};
 const audio=Buffer.alloc(8000).toString('base64'),edit={field:'rules',operation:'replace',item_number:1},headers={'X-Loophole-Client':'web','Content-Type':'application/json'};
 const wrongType=await fetch(base+'/api/world/revise',{method:'POST',headers:{...headers,'Content-Type':'audio/pcm'},body:audio});assert.equal(wrongType.status,415);
 const invalid=['null','{broken','{}',JSON.stringify({audio:'not valid base64!',brief,edit}),JSON.stringify({audio:'AAAA',brief,edit}),JSON.stringify({audio,brief:{...brief,rules:[]},edit}),JSON.stringify({audio,brief:{...brief,rubric:[]},edit}),JSON.stringify({audio,brief}),JSON.stringify({audio,brief,edit:{...edit,item_number:2}}),JSON.stringify({audio,brief,edit:{...edit,field:'actors'}})];
 // More than the per-minute limit proves rejected requests never consume that budget.
 for(let i=0;i<14;i++){
  const response=await fetch(base+'/api/world/revise',{method:'POST',headers,body:invalid[i%invalid.length]});
  assert.equal(response.status,400,await response.text());
 }
 const oversized=await fetch(base+'/api/world/revise',{method:'POST',headers,body:JSON.stringify({audio:'A'.repeat(2600001),brief,edit})});
 assert.equal(oversized.status,413);
});

test('contextual voice revision retains method, origin, and application-header gates',async()=>{
 assert.equal((await fetch(base+'/api/world/revise')).status,405);
 const missing=await fetch(base+'/api/world/revise',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(missing.status,403);
 const crossOrigin=await fetch(base+'/api/world/revise',{method:'POST',headers:{'Content-Type':'application/json','X-Loophole-Client':'web',Origin:'https://example.com'},body:'{}'});assert.equal(crossOrigin.status,403);
});
