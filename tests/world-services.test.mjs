import test from 'node:test';import assert from 'node:assert/strict';
import {transcribeWorld,interpretWorld,analyzeWorld,validateWorldRevision,reviseWorld} from '../world-services.mjs';
const brief={world:'A tool library',actors:['Guests'],resources:['Drills'],rules:['Any guest may borrow a drill.'],rubric:['Guests must not borrow drills.']};
const env={ASSEMBLYAI_API_KEY:'test'};
test('one Dictation request yields the original speech and a structured world/rubric draft',async()=>{const original=globalThis.fetch;let calls=0;try{globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://dictation.assemblyai.com/transcribe');const config=JSON.parse(await options.body.get('config').text());assert.match(config.llm_instruction,/CURRENT RULES/);assert.match(config.llm_instruction,/RUBRIC/);assert.equal(config.sample_rate,16000);return Response.json({text:'My world is a tool library.',llm_response:JSON.stringify(brief),llm_error:null,session_id:'session-1'});};const r=await transcribeWorld(new Uint8Array(8000),env);assert.deepEqual(r.brief,brief);assert.equal(r.receipt.requestId,'session-1');assert.equal(calls,1);}finally{globalThis.fetch=original;}});
test('failed structured rewriting preserves speech and does not apply an invalid world',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({text:'My original description.',llm_response:JSON.stringify(brief),llm_error:'timeout'});const r=await transcribeWorld(new Uint8Array(8000),env);assert.equal(r.brief,null);assert.equal(r.text,'My original description.');assert.match(r.warning,/Extract world from text/);}finally{globalThis.fetch=original;}});
test('typed interpretation returns a reviewed draft, while invalid generated models are rejected',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify(brief)}}]});assert.deepEqual((await interpretWorld('A tool library',env)).brief,brief);globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({mode:'simulation',explanation:'Looks safe'})}}]});await assert.rejects(analyzeWorld(brief,env),e=>e.status===502&&/validation/.test(e.message));}finally{globalThis.fetch=original;}});
test('invalid input and provider failure do not become a successful critique',async()=>{await assert.rejects(analyzeWorld({...brief,rubric:[]},env),e=>e.status===400);const original=globalThis.fetch;try{globalThis.fetch=async()=>new Response('{}',{status:429});await assert.rejects(analyzeWorld(brief,env),e=>e.status===429);}finally{globalThis.fetch=original;}});
test('explicit critique uses one provider call and rejects an unexpected simulation',async()=>{const original=globalThis.fetch;let calls=0;try{globalThis.fetch=async(url,options)=>{calls++;assert.match(JSON.parse(options.body).messages[0].content,/Critique the user's current rules/);return Response.json({choices:[{message:{content:JSON.stringify({mode:'review',explanation:'A qualitative assessment',assessments:[{rubricIndex:0,status:'potential_gap',scenario:'A guest borrows a drill.',reasoning:'The current rule permits it.',suggestedRevision:'Restrict drill borrowing.'}]})}}]});};const r=await analyzeWorld(brief,env,true);assert.equal(r.analysis.mode,'review');assert.equal(calls,1);await assert.rejects(analyzeWorld(brief,env,'true'),e=>e.status===400);assert.equal(calls,1);}finally{globalThis.fetch=original;}});
test('malformed JSON gets disclosed syntax repair and still requires complete model validation',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{"mode":"review","explanation":"Needs review","assessments":[{"rubricIndex":0,"status":"potential_gap","scenario":"A guest borrows a drill.","reasoning":"The rule allows it.","suggestedRevision":"Limit who may borrow drills."}]'}}]});const r=await analyzeWorld(brief,env,true);assert.equal(r.receipt.jsonSyntaxRepaired,true);assert.equal(r.analysis.assessments.length,1);globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{"mode":"review","explanation":"Needs review","assessments":['}}]});await assert.rejects(analyzeWorld(brief,env,true),e=>e.status===502&&/every rubric/.test(e.message));}finally{globalThis.fetch=original;}});

const audio=length=>Buffer.alloc(length).toString('base64');
const target={field:'rules',operation:'replace',item_number:1};

test('revision JSON validates canonical base64, PCM sample sizes, baseline and selected target',()=>{
  for(const size of [8000,1920000]){
    const result=validateWorldRevision({audio:audio(size),brief,edit:target});
    assert.ok(result.pcm instanceof Uint8Array);
    assert.equal(result.pcm.byteLength,size);
    assert.deepEqual(result.brief,brief);
    assert.notEqual(result.brief,brief);
    assert.deepEqual(result.edit,target);
    assert.notEqual(result.edit,target);
  }
  const valid=audio(8000),noncanonical=valid.slice(0,-2)+'B=';
  const invalid=[null,[],{}, {audio:valid,brief,edit:target,extra:true}, {audio:valid,brief:{...brief,rubric:[]},edit:target},...['',valid+'\n','!'+valid.slice(1),valid.slice(1),'AAAA=AAA',noncanonical,audio(7998),audio(8001),audio(1920002)].map(encoded=>({audio:encoded,brief,edit:target}))];
  for(const input of invalid)assert.throws(()=>validateWorldRevision(input),error=>error.status===400);
});

test('one Dictation request returns plain wording for only the explicitly selected target',async()=>{
  const original=globalThis.fetch,baseline={...brief,rules:[...brief.rules,'All borrowed tools must be checked at return.']},before=structuredClone(baseline);let calls=0;
  const wording='Members may borrow a ladder. Guests may not borrow drills. Each person may hold at most three tools.';
  try{
    globalThis.fetch=async(url,options)=>{
      calls++;
      assert.equal(url,'https://dictation.assemblyai.com/transcribe');
      assert.equal(options.method,'POST');
      assert.equal(options.headers.Authorization,'test');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.body.get('audio').size,8000);
      const config=JSON.parse(await options.body.get('config').text());
      assert.equal(config.sample_rate,16000);
      assert.equal(config.channels,1);
      assert.ok(config.llm_instruction.length<=2048);
      assert.match(config.llm_instruction,/plain-text field value/);
      assert.match(config.llm_instruction,/explicit self-corrections/);
      assert.match(config.llm_instruction,/condition, quantity, negation/);
      assert.doesNotMatch(config.llm_instruction,/tool library|Drills|Guests must not borrow drills|item_number/);
      assert.deepEqual([...options.body.keys()],['audio','config']);
      return Response.json({text:'Members may borrow a ladder, um, and two, sorry three tools.',llm_response:wording,llm_error:null,session_id:'revision-1',audio_duration_ms:250});
    };
    const result=await reviseWorld(new Uint8Array(8000),baseline,env,target);
    assert.equal(calls,1);
    assert.deepEqual(result.brief,{...baseline,rules:[wording,baseline.rules[1]]});
    assert.deepEqual(baseline,before);
    assert.deepEqual(result.edit,target);
    assert.equal(result.candidateSource,'dictation-rewrite');
    assert.equal(result.structured,wording);
    assert.equal(result.revision,true);
    assert.equal(result.inputPurpose,'revision');
    assert.equal(result.receipt.purpose,'revision');
    assert.equal(result.receipt.requestId,'revision-1');
    assert.equal(result.receipt.durationMs,250);
    assert.equal(result.warning,'');
    assert.equal(Object.hasOwn(result,'analysis'),false);
    assert.equal(Object.hasOwn(result,'edits'),false);
  }finally{globalThis.fetch=original;}
});

test('explicit append and world replacement leave all untargeted fields and list items unchanged',async()=>{
  const original=globalThis.fetch;
  const cases=[
    [{field:'rules',operation:'append'},'Members may reserve one ladder.',{...brief,rules:[...brief.rules,'Members may reserve one ladder.']}],
    [{field:'rubric',operation:'append'},'Every tool is returned.',{...brief,rubric:[...brief.rubric,'Every tool is returned.']}],
    [{field:'rubric',operation:'replace',item_number:1},'Every borrower is a member.',{...brief,rubric:['Every borrower is a member.']}],
    [{field:'world',operation:'replace'},'A neighborhood library\nwith a workshop',{...brief,world:'A neighborhood library\nwith a workshop'}]
  ];
  try{
    for(const [edit,wording,expected] of cases){
      globalThis.fetch=async()=>Response.json({text:wording,llm_response:wording,llm_error:null});
      const result=await reviseWorld(new Uint8Array(8000),brief,env,edit);
      assert.deepEqual(result.brief,expected);
      assert.deepEqual(result.edit,edit);
    }
  }finally{globalThis.fetch=original;}
});

test('large baselines stay local and do not expand the Dictation instruction',async()=>{
  const original=globalThis.fetch,baseline={...brief,rules:Array.from({length:12},(_,index)=>`Rule ${index+1}: ${'A'.repeat(750)}`)},before=structuredClone(baseline);
  try{
    globalThis.fetch=async(_url,options)=>{
      const config=JSON.parse(await options.body.get('config').text());
      assert.ok(config.llm_instruction.length<=2048);
      assert.equal(config.llm_instruction.includes(baseline.rules[0]),false);
      return Response.json({text:'Each visitor may borrow one tool.',llm_response:'Each visitor may borrow one tool.'});
    };
    const result=await reviseWorld(new Uint8Array(8000),baseline,env,target);
    assert.deepEqual(result.brief.rules,['Each visitor may borrow one tool.',...baseline.rules.slice(1)]);
    assert.deepEqual(result.brief.rubric,baseline.rubric);
    assert.deepEqual(baseline,before);
  }finally{globalThis.fetch=original;}
});

test('line breaks in a revised list value preserve one item and later item numbers',async()=>{
  const original=globalThis.fetch,baseline={...brief,rules:['First rule.','Second rule.']};
  const multiline='First\r\nclause\rsecond\nthird\u0085fourth\u2028fifth\u2029sixth\vseventh\feighth';
  try{
    globalThis.fetch=async()=>Response.json({text:multiline,llm_response:multiline});
    const result=await reviseWorld(new Uint8Array(8000),baseline,env,target);
    assert.deepEqual(result.brief.rules,['First clause second third fourth fifth sixth seventh eighth','Second rule.']);
    assert.equal(result.brief.rules.join('\n').split(/\r?\n/).length,2);
    assert.deepEqual(result.edit,target);
    assert.equal(result.structured,multiline);
    assert.deepEqual(baseline.rules,['First rule.','Second rule.']);
    const appended=await reviseWorld(new Uint8Array(8000),brief,env,{field:'rubric',operation:'append'});
    assert.deepEqual(appended.brief.rubric,[...brief.rubric,'First clause second third fourth fifth sixth seventh eighth']);
  }finally{globalThis.fetch=original;}
});

test('unavailable cleanup may propose the original transcript with an explicit source and review warning',async()=>{
  const original=globalThis.fetch,speech='Each member may hold two, sorry three tools.';
  try{
    for(const response of [{text:speech,llm_response:null,llm_error:'timeout'},{text:speech,llm_response:null,llm_error:null},{text:speech},{text:speech,llm_response:'Untrusted partial rewrite.',llm_error:'error'}]){
      globalThis.fetch=async()=>Response.json(response);
      const result=await reviseWorld(new Uint8Array(8000),brief,env,target);
      assert.equal(result.candidateSource,'original-transcript');
      assert.deepEqual(result.brief,{...brief,rules:[speech]});
      assert.equal(result.text,speech);
      assert.match(result.warning,/cleanup was unavailable.*original transcript.*review it carefully/);
    }
  }finally{globalThis.fetch=original;}
});

test('successful empty cleanup never restores filler speech or prepares a revision',async()=>{
  const original=globalThis.fetch;
  try{
    for(const rewrite of ['', ' \n\r ', '\u0085\u2028\u2029']){
      globalThis.fetch=async()=>Response.json({text:'Um, uh, um.',llm_response:rewrite,llm_error:null});
      const result=await reviseWorld(new Uint8Array(8000),brief,env,target);
      assert.equal(result.brief,null);
      assert.equal(result.structured,rewrite);
      assert.equal(result.candidateSource,'dictation-rewrite');
      assert.match(result.warning,/No changes were prepared.*empty or invalid/);
      assert.equal(result.text,'Um, uh, um.');
    }
  }finally{globalThis.fetch=original;}
});

test('invalid cleanup types or oversized values do not prepare a changed draft',async()=>{
  const original=globalThis.fetch,before=structuredClone(brief);
  try{
    for(const rewrite of [42,[],{text:'Unexpected shape'},'x'.repeat(801)]){
      globalThis.fetch=async()=>Response.json({text:'Original words.',llm_response:rewrite,llm_error:null});
      const result=await reviseWorld(new Uint8Array(8000),brief,env,target);
      assert.equal(result.brief,null);
      assert.match(result.warning,/No changes were prepared/);
      assert.equal(result.candidateSource,typeof rewrite==='string'?'dictation-rewrite':null);
      assert.deepEqual(brief,before);
    }
  }finally{globalThis.fetch=original;}
});

test('invalid targets are rejected before provider or configuration access',async()=>{
  const original=globalThis.fetch;let calls=0;
  const invalid=[null,undefined,[],{}, {field:'actors',operation:'append'}, {field:'resources',operation:'replace',item_number:1}, {field:'rules',operation:'remove',item_number:1}, {field:'rules',operation:'replace',item_number:0}, {field:'rules',operation:'replace',item_number:2}, {field:'rules',operation:'replace',item_number:'1'}, {field:'rules',operation:'replace',index:1}, {field:'rules',operation:'append',item_number:1}, {field:'world',operation:'append'}, {field:'world',operation:'replace',item_number:1}, {...target,extra:true}, {...target,value:'Must come from Dictation'}, {field:'__proto__',operation:'replace'}];
  try{
    globalThis.fetch=async()=>{calls++;throw new Error('Must not be called');};
    for(const edit of invalid){
      assert.throws(()=>validateWorldRevision({audio:audio(8000),brief,edit}),error=>error.status===400);
      await assert.rejects(reviseWorld(new Uint8Array(8000),brief,{},edit),error=>error.status===400);
    }
    for(const field of ['rules','rubric']){
      const full={...brief,[field]:Array.from({length:12},(_,i)=>`Item ${i+1}`)},edit={field,operation:'append'};
      assert.throws(()=>validateWorldRevision({audio:audio(8000),brief:full,edit}),error=>error.status===400&&/12 items/.test(error.message));
      await assert.rejects(reviseWorld(new Uint8Array(8000),full,{},edit),error=>error.status===400);
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('direct audio and baseline input errors are rejected before any provider request',async()=>{
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw new Error('Must not be called');};
    for(const pcm of [null,new Uint16Array(8000),new Uint8Array(7998),new Uint8Array(8001),new Uint8Array(1920002)])await assert.rejects(reviseWorld(pcm,brief,env,target),error=>error.status===400);
    await assert.rejects(reviseWorld(new Uint8Array(8000),{...brief,rubric:[]},env,target),error=>error.status===400);
    await assert.rejects(reviseWorld(new Uint8Array(8000),brief,{},target),error=>error.status===503);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('revision provider failures and absent speech never yield an applicable revision',async()=>{
  const original=globalThis.fetch;
  try{
    for(const status of [429,500]){
      globalThis.fetch=async()=>new Response('{}',{status});
      await assert.rejects(reviseWorld(new Uint8Array(8000),brief,env,target),error=>error.status===(status===429?429:502)&&/world is unchanged/.test(error.message));
    }
    globalThis.fetch=async()=>Response.json({text:' ',llm_response:'Some words.'});
    await assert.rejects(reviseWorld(new Uint8Array(8000),brief,env,target),error=>error.status===422);
  }finally{globalThis.fetch=original;}
});
