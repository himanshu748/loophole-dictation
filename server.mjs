import {interpretWorld,transcribeWorld,analyzeWorld,validateReviewOnly} from './world-services.mjs';
import {validateBrief} from './public/world-model.js';
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileExample,validateDomain} from './public/compiler.js';
import {gateway,transcribe} from './services.mjs';
export {compilerPrompt} from './services.mjs';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const key=process.env.ASSEMBLYAI_API_KEY;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.json':'application/json','.wav':'audio/wav','.pcm':'audio/pcm'};
const limits=new Map(); let active=0, total=0, day=new Date().toISOString().slice(0,10);


function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req,max) {let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(new Error('Recording is too large. Keep it under 60 seconds.'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
function consume(req) {
  const now=Date.now(), ip=req.socket.remoteAddress;
  if(new Date().toISOString().slice(0,10)!==day){day=new Date().toISOString().slice(0,10);total=0;}
  if(limits.size>5000) limits.clear();
  const recent=(limits.get(ip)||[]).filter(t=>now-t<60000);
  if(recent.length>=12 || active>=4 || total>=Number(process.env.DAILY_API_LIMIT||200)) throw Object.assign(new Error('Voice service limit reached. Try again later; the built-in experiments still work.'),{status:429});
  limits.set(ip,[...recent,now]); total++;
}

export const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy','microphone=(self), camera=(), geolocation=()');
  let counted=false;
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/health' && req.method==='GET') return json(res,200,{speechConfigured:!!key,compiler:'AssemblyAI LLM Gateway',model:process.env.ASSEMBLYAI_LLM_MODEL||'qwen3.5-4b-32k-fast'});
    if(url.pathname.startsWith('/api/')) {
      if(req.method!=='POST') return json(res,405,{error:'Use POST for this action.'});
      const origin=req.headers.origin;
      if(origin && new URL(origin).host!==req.headers.host) return json(res,403,{error:'This request must come from the Loophole page.'});
      // A custom header prevents cross-site form submissions from spending API quota.
      if(req.headers['x-loophole-client']!=='web') return json(res,403,{error:'Missing application request header.'});
      if(!['/api/compile','/api/transcribe','/api/world/interpret','/api/world/transcribe','/api/world/analyze'].includes(url.pathname)) return json(res,404,{error:'Unknown action.'});
      if(['/api/world/interpret','/api/world/analyze'].includes(url.pathname)) {
        const data=JSON.parse((await body(req,24000)).toString());
        if(url.pathname.endsWith('/interpret')) {if(!data||typeof data.text!=='string'||!data.text.trim()||data.text.length>6000)return json(res,400,{error:'Describe your world in 1–6,000 characters.'});}
        else {try{validateBrief(data?.brief,{complete:true});validateReviewOnly(data?.reviewOnly);}catch(e){return json(res,400,{error:e.message});}}
        consume(req);active++;counted=true;
        return json(res,200,url.pathname.endsWith('/interpret')?await interpretWorld(data.text):await analyzeWorld(data.brief,process.env,data.reviewOnly));
      }
      if(url.pathname==='/api/compile') {
        const data=JSON.parse((await body(req,16000)).toString());
        if(!data||typeof data.text!=='string' || !data.text.trim() || data.text.length>2000) return json(res,400,{error:'Use between 1 and 2,000 characters for a rule.'});
        let domain;try{domain=validateDomain(data.domain);}catch(e){return json(res,400,{error:e.message});}
        const example=compileExample(data.text,domain);
        if(example) return json(res,200,example);
        consume(req);active++;counted=true;
        return json(res,200,await gateway(data.text,process.env,domain));
      }
      if(!key) return json(res,503,{error:'Voice is not configured. Add ASSEMBLYAI_API_KEY on the server, or type a rule.'});
      if(req.headers['content-type']!=='audio/pcm') return json(res,415,{error:'Expected mono 16 kHz PCM audio.'});
      const pcm=await body(req,1920000);
      if(pcm.length<8000 || pcm.length%2!==0) return json(res,400,{error:'The recording was too short. Speak for at least a quarter of a second.'});
      consume(req);active++;counted=true;
      return json(res,200,url.pathname==='/api/world/transcribe'?await transcribeWorld(pcm):await transcribe(pcm));
    }
    if(req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Method not allowed.'});
    const rel=decodeURIComponent(url.pathname==='/'?'/index.html':['/play','/play/'].includes(url.pathname)?'/play.html':['/lab','/lab/'].includes(url.pathname)?'/lab.html':['/create','/create/'].includes(url.pathname)?'/create.html':url.pathname);
    const file=path.resolve(root,'.'+rel);
    if(!file.startsWith(root+path.sep)) return json(res,403,{error:'Forbidden.'});
    const info=await stat(file);
    if(!info.isFile()) return json(res,404,{error:'Not found.'});
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':file.includes('/fonts/')?'public, max-age=86400':'no-cache'});
    res.end(req.method==='HEAD'?undefined:await readFile(file));
  } catch(error) {
    if(res.headersSent) return res.end();
    const status=error.code==='ENOENT'?404:error.status|| (error instanceof SyntaxError?400:500);
    const message=status===404?'Not found.':error.name==='TimeoutError'?'The provider took too long. Retry; your rule has not changed.':error.message;
    json(res,status,{error:message});
  } finally {if(counted) active--;}
});
if(process.argv[1]===fileURLToPath(import.meta.url)) server.listen(Number(process.env.PORT||4317),process.env.HOST||'127.0.0.1',()=>console.log(`Loophole at http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||4317}`));
