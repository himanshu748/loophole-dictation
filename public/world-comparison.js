import {worldSearch} from './world-model.js';
import {validateWorldBundle} from './world-share.js';

// Preserve list order while ignoring object-key order in validated model data.
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
const signature=value=>JSON.stringify(stable(value));

function additions(previous,current){
  const remaining=[...previous];
  return current.filter(item=>{const index=remaining.indexOf(item);if(index<0)return true;remaining.splice(index,1);return false;});
}
const difference=(previous,current)=>({added:additions(previous,current),removed:additions(current,previous)});

function modelSignature(analysis){
  if(analysis.mode!=='simulation')return null;
  const {assumptions,variables,actions,criteria}=analysis;
  return signature({assumptions,variables,actions,criteria});
}

function summarize(bundle){
  const {analysis}=bundle;
  if(analysis.mode==='simulation')return {mode:analysis.mode,...worldSearch(analysis)};
  // AI assessments do not have a search verdict or an explored state count.
  return {mode:analysis.mode,found:null,exhaustive:null,truncated:null,states:null,transitions:null,boundaries:null,violations:[],trace:[],limits:null,assessments:analysis.assessments};
}

export function compareWorlds(previousBundle,currentBundle){
  const previous=previousBundle==null?null:validateWorldBundle(previousBundle);
  const current=validateWorldBundle(currentBundle);
  const before=previous?summarize(previous):null,after=summarize(current);
  const rules=difference(previous?.brief.rules||[],current.brief.rules);
  const rubric=difference(previous?.brief.rubric||[],current.brief.rubric);
  const sameRubric=!!previous&&signature(previous.brief.rubric)===signature(current.brief.rubric);
  const modeChanged=!!previous&&previous.analysis.mode!==current.analysis.mode;
  const modelChanged=!!previous&&modelSignature(previous.analysis)!==modelSignature(current.analysis);
  const replayCompatible=before?.mode==='simulation'&&after.mode==='simulation'&&before.found&&before.trace.length>0&&before.trace.every(move=>current.analysis.actions.some(action=>action.id===move.action&&action.label===move.label));
  let note;
  if(!previous)note='This is the first reviewed version. There is no earlier result to compare.';
  else if(modeChanged)note='The review mode changed. An AI critique and a simulation do not provide equivalent evidence.';
  else if(!sameRubric)note='The rubric changed, so the two versions do not test the same requirements.';
  else if(modelChanged)note='The modeled assumptions, facts, actions, or criteria changed. Review those changes before interpreting the results.';
  else if(after.mode==='review')note='Both versions are AI critiques. Their assessments describe possible gaps and cannot establish a proven fix.';
  else note='Both versions use the same rubric and model. Each result comes from a fresh local search.';
  note+=' A changed rubric or model is not proof of a fix. Simulation results apply only within each reviewed model and its search limits.';
  return {rules,rubric,sameRubric,modelChanged,modeChanged,replayCompatible:!!replayCompatible,before,after,note};
}
