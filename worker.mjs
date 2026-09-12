import {interpretWorld,transcribeWorld,analyzeWorld,validateReviewOnly,validateWorldRevision,reviseWorld} from './world-services.mjs';
import {validateBrief} from './public/world-model.js';
import {DurableObject} from 'cloudflare:workers';
import {compileExample,validateDomain} from './public/compiler.js';
import {gateway,transcribe} from './services.mjs';

const headers={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy':'microphone=(self), camera=(), geolocation=()',
};
const json=(status,data)=>Response.json(data,{status,headers:{...headers,'Cache-Control':'no-store'}});
const failure=(message,status)=>Object.assign(new Error(message),{status});
async function readBody(request,max){
  const chunks=[];let size=0;
  if(request.body)for await(const chunk of request.body){size+=chunk.length;if(size>max)throw failure('Request is too large. Keep recordings under 60 seconds.',413);chunks.push(chunk);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

// One named object owns a persistent daily provider budget across all edge instances.
export class VoiceBudget extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.active=0;this.recent=new Map();}
  async call(kind,payload,ip){
    const now=Date.now(),recent=(this.recent.get(ip)||[]).filter(t=>now-t<60000);
    if(this.active>=4||recent.length>=12)return {status:429,error:'Voice service is busy. Try again later; built-in experiments still work.'};
    this.active++;this.recent.set(ip,[...recent,now]);
    if(this.recent.size>5000)this.recent.clear();
    try{
      const allowed=await this.ctx.storage.transaction(async tx=>{
        const day=new Date().toISOString().slice(0,10),saved=await tx.get('budget');
        const count=saved?.day===day?saved.count:0;
        if(count>=Number(this.env.DAILY_API_LIMIT||200))return false;
        await tx.put('budget',{day,count:count+1});return true;
      });
      if(!allowed)return {status:429,error:'The demo’s daily voice limit has been reached. Built-in experiments still work.'};
      return {status:200,data:kind==='world-interpret'?await interpretWorld(payload,this.env):kind==='world-analyze'?await analyzeWorld(payload.brief,this.env,payload.reviewOnly):kind==='world-transcribe'?await transcribeWorld(payload,this.env):kind==='world-revise'?await reviseWorld(payload.pcm,payload.brief,this.env,payload.edit):kind==='compile'?await gateway(payload.text,this.env,payload.domain):await transcribe(payload,this.env)};
    }catch(e){return {status:e.status||422,error:e.name==='TimeoutError'?'The provider took too long. Retry; your rule is unchanged.':e.message};}
    finally{this.active--;}
  }
}
export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url);
      if(!url.pathname.startsWith('/api/')){
        const asset=await env.ASSETS.fetch(request),response=new Response(asset.body,asset);
        for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
        return response;
      }
      if(url.pathname==='/api/health'&&request.method==='GET')return json(200,{speechConfigured:!!env.ASSEMBLYAI_API_KEY,compiler:'AssemblyAI LLM Gateway',model:env.ASSEMBLYAI_LLM_MODEL||'qwen3.5-4b-32k-fast'});
      if(request.method!=='POST')return json(405,{error:'Use POST for this action.'});
      const origin=request.headers.get('Origin');
      if((origin&&origin!==url.origin)||request.headers.get('X-Loophole-Client')!=='web')return json(403,{error:'This request must come from the Loophole page.'});
      let kind,payload;
      if(url.pathname==='/api/world/revise'){
        if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json(415,{error:'Expected JSON containing the recording and reviewed world.'});
        const data=JSON.parse(new TextDecoder().decode(await readBody(request,2600000)));
        try{payload=validateWorldRevision(data);}catch(error){return json(400,{error:error.message});}
        kind='world-revise';
      }else if(['/api/world/interpret','/api/world/analyze'].includes(url.pathname)){
        const data=JSON.parse(new TextDecoder().decode(await readBody(request,24000)));
        if(url.pathname.endsWith('/interpret')){
          if(!data||typeof data.text!=='string'||!data.text.trim()||data.text.length>6000)return json(400,{error:'Describe your world in 1–6,000 characters.'});
          kind='world-interpret';payload=data.text;
        }else{
          try{payload={brief:validateBrief(data?.brief,{complete:true}),reviewOnly:validateReviewOnly(data?.reviewOnly)};}catch(e){return json(400,{error:e.message});}
          kind='world-analyze';
        }
      }else if(url.pathname==='/api/compile'){
        const data=JSON.parse(new TextDecoder().decode(await readBody(request,16000)));
        if(!data||typeof data.text!=='string'||!data.text.trim()||data.text.length>2000)return json(400,{error:'Use between 1 and 2,000 characters for a rule.'});
        let domain;try{domain=validateDomain(data.domain);}catch(e){return json(400,{error:e.message});}
        const example=compileExample(data.text,domain);if(example)return json(200,example);
        kind='compile';payload={text:data.text,domain};
      }else if(['/api/transcribe','/api/world/transcribe'].includes(url.pathname)){
        if(request.headers.get('Content-Type')!=='audio/pcm')return json(415,{error:'Expected mono 16 kHz PCM audio.'});
        payload=await readBody(request,1920000);kind=url.pathname==='/api/world/transcribe'?'world-transcribe':'transcribe';
        if(payload.length<8000||payload.length%2!==0)return json(400,{error:'The recording is too short or malformed.'});
      }else return json(404,{error:'Unknown action.'});
      if(!env.ASSEMBLYAI_API_KEY)return json(503,{error:'Voice service is not configured. Built-in rules still work.'});
      const result=await env.VOICE_BUDGET.getByName('public-demo-v1').call(kind,payload,request.headers.get('CF-Connecting-IP')||'unknown');
      return json(result.status,result.error?{error:result.error}:result.data);
    }catch(e){return json(e.status||(e instanceof SyntaxError?400:500),{error:e.status?e.message:'The request could not be processed. Your applied rule is unchanged.'});}
  }
};
