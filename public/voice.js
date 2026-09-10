export async function startCapture(onLevel,onLimit) {
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
  let context;
  try {
    context=new AudioContext({sampleRate:16000});
    await context.audioWorklet.addModule('/recorder.js');
    await context.resume();
    const source=context.createMediaStreamSource(stream),capture=new AudioWorkletNode(context,'loophole-capture'),silent=context.createGain();
    silent.gain.value=0;source.connect(capture);capture.connect(silent);silent.connect(context.destination);
    let chunks=[],frames=0,done=false;
    capture.port.onmessage=e=>{if(done)return;chunks.push(e.data);frames+=e.data.length;onLevel(Math.sqrt(e.data.reduce((a,x)=>a+x*x,0)/e.data.length),frames/context.sampleRate);};
    const timer=setTimeout(onLimit,55000);
    return {async stop(){if(done)return null;done=true;clearTimeout(timer);capture.port.onmessage=null;stream.getTracks().forEach(t=>t.stop());const rate=context.sampleRate;await context.close();const samples=new Float32Array(frames);let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}chunks=[];const count=Math.floor(frames*16000/rate),buffer=new ArrayBuffer(count*2),view=new DataView(buffer);for(let i=0;i<count;i++){const start=Math.floor(i*rate/16000),end=Math.max(start+1,Math.floor((i+1)*rate/16000));let sum=0;for(let j=start;j<Math.min(end,samples.length);j++)sum+=samples[j];const value=Math.max(-1,Math.min(1,sum/(end-start)));view.setInt16(i*2,value<0?value*32768:value*32767,true);}return buffer;}};
  } catch(error) {stream.getTracks().forEach(t=>t.stop());if(context)await context.close().catch(()=>{});throw error;}
}
