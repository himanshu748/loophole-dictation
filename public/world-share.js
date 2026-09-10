import {validateBrief,validateAnalysis} from './world-model.js';
export function validateWorldBundle(input){
  if(!input||input.version!==1)throw new Error('This shared world uses an unsupported format.');
  const brief=validateBrief(input.brief,{complete:true}),analysis=validateAnalysis(input.analysis,brief);
  return {version:1,brief,analysis};
}
export function encodeWorld(input){
  const bundle=validateWorldBundle(input),bytes=new TextEncoder().encode(JSON.stringify(bundle));
  if(bytes.length>40000)throw new Error('This world is too large for a shared link. Export its evidence instead.');
  return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decodeWorld(encoded){
  if(typeof encoded!=='string'||encoded.length>55000||!/^[A-Za-z0-9_-]+$/.test(encoded))throw new Error('This shared world link is invalid.');
  try{const raw=atob(encoded.replaceAll('-','+').replaceAll('_','/'));return validateWorldBundle(JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0)))));}catch{throw new Error('This shared world could not be validated. Describe a new world or request a fresh link.');}
}
