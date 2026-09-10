import {defaultRubric,validateRubric} from './rubric.js';
import {validatePolicy,SCENARIOS} from './engine.js';
export function policyText(input){
 const p=validatePolicy(input),badge=p.trigger==='any'?'any badge':`a ${p.trigger} badge`;
 return `Open the gate for ${badge}. ${p.passage==='shared'?'Anyone may cross while it stays open.':p.passage==='single'?'Let one robot cross, whoever arrives, then close the gate.':'Only the robot that scanned may cross; close the gate after it passes.'}${p.recheck?' Check the same badge requirement again at crossing.':' Check the badge only when it scans.'}`;
}
export function shareQuery(policy,scenario,rubric=defaultRubric('checkpoint')){const p=validatePolicy(policy);if(!Object.hasOwn(SCENARIOS,scenario))throw new Error('Unknown experiment.');return new URLSearchParams({rule:`${p.trigger}.${p.passage}.${p.recheck?1:0}`,experiment:scenario,rubric:JSON.stringify(validateRubric('checkpoint',rubric))}).toString();}
export function readSharedRule(query){
 const params=new URLSearchParams(query);if(!params.has('rule'))return null;
 const parts=params.get('rule').split('.');if(parts.length!==3||!['0','1'].includes(parts[2]))throw new Error('This shared rule is invalid. The starter rule is ready instead.');
 const policy=validatePolicy({trigger:parts[0],passage:parts[1],recheck:parts[2]==='1'}),scenario=params.get('experiment')||'tailgate';
 if(!Object.hasOwn(SCENARIOS,scenario))throw new Error('This shared experiment is unavailable.');const rubric=params.has('rubric')?validateRubric('checkpoint',JSON.parse(params.get('rubric'))):defaultRubric('checkpoint');return {policy,scenario,rubric,text:policyText(policy)};
}
