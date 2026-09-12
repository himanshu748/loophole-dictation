import {validateWorldBundle} from './world-share.js';

const KEY='loophole.workspace.v1';
const MAX_BYTES=400000,MAX_IMPORT_BYTES=1000000,MAX_WORLDS=8;
const fieldLimits={world:2000,actors:6000,resources:6000,rules:16000,rubric:16000};
const fail=message=>{throw new Error(message);};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const has=(x,key)=>Object.hasOwn(x,key);
const bytes=text=>new TextEncoder().encode(text).length;
const bounded=(value,label,max)=>typeof value==='string'&&value.length<=max?value:fail(`${label} must be text with at most ${max.toLocaleString('en-US')} characters.`);

function draft(input){
  if(input===null)return null;
  if(!record(input)||!record(input.fields)||typeof input.edited!=='boolean')fail('The saved draft is invalid.');
  const fields=Object.fromEntries(Object.entries(fieldLimits).map(([name,max])=>[name,bounded(input.fields[name],`Draft ${name}`,max)]));
  return {description:bounded(input.description,'Draft description',12000),fields,source:input.source===null?null:bounded(input.source,'Draft source',1000),edited:input.edited};
}

function worldId(value){
  if(typeof value!=='string'||! /^[a-zA-Z0-9_-]{1,72}$/.test(value)||['__proto__','prototype','constructor'].includes(value))fail('The saved world has an invalid identifier.');
  return value;
}

function timestamp(value){
  if(!(typeof value==='string'||typeof value==='number'||value instanceof Date))fail('The saved world has an invalid date.');
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))fail('The saved world has an invalid date.');
  return date.toISOString();
}

function sanitize(input){
  if(!record(input)||input.version!==1)fail('This workspace uses an unsupported format.');
  if(!Array.isArray(input.worlds)||input.worlds.length>MAX_WORLDS)fail('Keep at most 8 saved worlds. Remove one before saving another.');
  const seen=new Set();
  const worlds=input.worlds.map(item=>{
    if(!record(item))fail('A saved world is invalid.');
    const id=worldId(item.id);
    if(seen.has(id))fail('The workspace contains duplicate world identifiers.');
    seen.add(id);
    const title=bounded(item.title,'World title',120).trim();
    if(!title)fail('Give the saved world a title.');
    return {id,title,updatedAt:timestamp(item.updatedAt),bundle:validateWorldBundle(item.bundle)};
  });
  const workspace={version:1,draft:draft(input.draft),worlds};
  if(bytes(JSON.stringify(workspace))>MAX_BYTES)fail('This workspace exceeds 400 KB. Remove a saved world or shorten the draft.');
  return workspace;
}

export function emptyWorkspace(){return {version:1,draft:null,worlds:[]};}

export function readWorkspace(storage){
  let raw;
  try{
    if(!storage||typeof storage.getItem!=='function')throw new Error();
    raw=storage.getItem(KEY);
  }catch{throw new Error('Browser storage is unavailable. You can continue in this tab and export your evidence.');}
  if(raw===null)return emptyWorkspace();
  try{
    if(typeof raw!=='string'||raw.length>MAX_BYTES||bytes(raw)>MAX_BYTES)throw new Error('The saved workspace exceeds 400 KB.');
    return sanitize(JSON.parse(raw));
  }catch(error){throw new Error(`The saved workspace could not be loaded. ${error.message} Existing stored data has not been changed.`);}
}

export function writeWorkspace(storage,input){
  const workspace=sanitize(input),serialized=JSON.stringify(workspace);
  try{
    if(!storage||typeof storage.setItem!=='function')throw new Error();
    storage.setItem(KEY,serialized);
  }catch(error){
    if(error?.name==='QuotaExceededError'||error?.code===22||error?.code===1014)throw new Error('Browser storage is full. Remove a saved world or export your evidence before clearing storage.');
    throw new Error('Browser storage is unavailable. Your changes remain in this tab; export evidence to keep them.');
  }
  return workspace;
}

export function parseWorldImport(text){
  if(typeof text!=='string'||!text.trim())fail('Choose a Loophole custom-world JSON file.');
  if(text.length>MAX_IMPORT_BYTES||bytes(text)>MAX_IMPORT_BYTES)fail('World imports must be at most 1 MB.');
  let input;
  try{input=JSON.parse(text);}catch{fail('This file is not valid JSON. Choose an exported Loophole custom world.');}
  if(!record(input)||input.version!==1)fail('This world file uses an unsupported format.');
  if(has(input,'applied')){
    if((has(input,'format')&&input.format!=='custom-world')||(has(input,'product')&&input.product!=='Loophole'))fail('Import a Loophole custom world, not a preset-world report.');
    input=input.applied;
  }
  try{return validateWorldBundle(input);}catch(error){throw new Error(`This world file could not be validated. ${error.message}`);}
}

export function addSavedWorld(input,bundle,{id,title,now}={}){
  const workspace=sanitize(input),clean=validateWorldBundle(bundle);
  const key=id===undefined?(globalThis.crypto?.randomUUID?.()||`world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`):worldId(id);
  const previous=workspace.worlds.find(item=>item.id===key);
  const saved={id:key,title:title===undefined?(previous?.title||clean.brief.world.slice(0,120)):title,updatedAt:timestamp(now===undefined?Date.now():now),bundle:clean};
  return sanitize({...workspace,worlds:[saved,...workspace.worlds.filter(item=>item.id!==key)]});
}

export function removeSavedWorld(input,id){
  const workspace=sanitize(input),key=worldId(id);
  return {...workspace,worlds:workspace.worlds.filter(item=>item.id!==key)};
}
