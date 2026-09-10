import {defaultRubric,validateRubric} from './rubric.js';
// Finite-state checkpoint model. No LLM participates in search or replay.
export const ROBOTS = Object.freeze([
  { id: 'B-01', name: 'Atlas', badge: 'blue' },
  { id: 'R-02', name: 'Pip', badge: 'red' },
]);
export const SCENARIOS = Object.freeze({
  tailgate: { name: 'Tailgating', detail: 'The blue robot passes first. Can the red robot follow?', overtake: false, revoke: false },
  theft: { name: 'Borrowed opening', detail: 'Either robot can move first. Who gets to use the opening?', overtake: true, revoke: false },
  revoked: { name: 'Revoked badge', detail: 'A blue badge may be revoked after scanning.', overtake: true, revoke: true },
});
export const DEFAULT_POLICY = Object.freeze({ trigger: 'blue', passage: 'shared', recheck: false });
export const FIXED_POLICY = Object.freeze({ trigger: 'blue', passage: 'bound', recheck: true });

export function validatePolicy(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Missing checkpoint rule.');
  if (!['blue','red','any'].includes(p.trigger) || !['shared','single','bound'].includes(p.passage) || typeof p.recheck !== 'boolean') throw new Error('Rule contains unsupported conditions.');
  if (Object.keys(p).some(k => !['trigger','passage','recheck'].includes(k))) throw new Error('Rule contains unknown fields.');
  return {trigger:p.trigger, passage:p.passage, recheck:p.recheck};
}
export function initialState() { return { inside: [], revoked: [], gate: false, grant: null }; }
export function validBadge(s, id) { return !s.revoked.includes(id) && ROBOTS.find(r => r.id === id)?.badge === 'blue'; }
function matches(s, id, trigger) { return trigger === 'any' || (!s.revoked.includes(id) && ROBOTS.find(r => r.id === id)?.badge === trigger); }
export function violation(s,rubric=defaultRubric('checkpoint')) {
  const r=validateRubric('checkpoint',rubric);
  return s.inside.find(id=>(r.badge!=='any'&&ROBOTS.find(robot=>robot.id===id)?.badge!==r.badge)||(r.unrevoked&&s.revoked.includes(id))) || (s.inside.length>r.capacity?s.inside.at(-1):null);
}
export function describePolicy(p) {
  return [
    {label:'Opens for',value:p.trigger === 'any' ? 'Any badge' : `${p.trigger === 'blue' ? 'Blue' : 'Red'} badges`},
    {label:'Lets through',value:({shared:'Anyone while open',single:'One robot, whoever arrives',bound:'Only the robot that scanned'})[p.passage]},
    {label:'Badge checked',value:p.recheck ? 'At scanning and crossing' : 'At scanning only'},
  ];
}
export function transition(state, action, policy, scenario='tailgate', rubric=defaultRubric('checkpoint')) {
  const r=validateRubric('checkpoint',rubric),p=validatePolicy(policy), cfg=SCENARIOS[scenario];
  if(!Object.hasOwn(SCENARIOS,scenario)) throw new Error('Unknown experiment.');
  const s=structuredClone(state), robot=ROBOTS.find(r=>r.id===action.robot);
  if(!robot) return {state:s,allowed:false,explanation:'Unknown robot.'};
  const outside=ROBOTS.filter(r=>!s.inside.includes(r.id));
  if(s.inside.includes(robot.id)) return {state:s,allowed:false,explanation:`${robot.name} has already crossed.`};
  if(action.type==='scan') {
    if(!matches(s,robot.id,p.trigger)) return {state:s,allowed:false,explanation:`${robot.name} cannot open the gate with ${s.revoked.includes(robot.id)?'a revoked':`a ${robot.badge}`} badge.`};
    s.gate=true; s.grant=p.passage==='bound' ? robot.id : 'any';
    return {state:s,allowed:true,explanation:`${robot.name} scans a ${robot.badge} badge. ${p.passage==='bound' ? 'This opening belongs to '+robot.name+'.' : 'The gate opens.'}`};
  }
  if(action.type==='revoke') {
    if(!cfg.revoke || robot.badge!=='blue' || s.revoked.includes(robot.id)) return {state:s,allowed:false,explanation:'Badge cannot be revoked in this state.'};
    s.revoked.push(robot.id);
    return {state:s,allowed:true,explanation:`${robot.name}'s blue badge is revoked while the robot is still outside.`};
  }
  if(action.type!=='enter') return {state:s,allowed:false,explanation:'Unknown action.'};
  if(!cfg.overtake && outside[0]?.id!==robot.id) return {state:s,allowed:false,explanation:`${robot.name} waits for the robot ahead.`};
  if(!s.gate) return {state:s,allowed:false,explanation:`${robot.name} stays outside. The gate is closed.`};
  if(p.passage==='bound' && s.grant!==robot.id) return {state:s,allowed:false,explanation:`${robot.name} stays outside. The opening belongs to another robot.`};
  if(p.recheck && !matches(s,robot.id,p.trigger)) return {state:s,allowed:false,explanation:`${robot.name} stays outside. Its badge fails the crossing check.`};
  s.inside.push(robot.id);
  if(p.passage!=='shared') { s.gate=false; s.grant=null; }
  const unsafe=violation(s,r);
  return {state:s,allowed:true,explanation:`${robot.name} crosses with ${s.revoked.includes(robot.id)?'a revoked':`a ${robot.badge}`} badge. ${unsafe?'The selected rubric is broken.':s.gate?'The gate remains open.':'The gate closes behind it.'}`};
}
function stateKey(s) { return JSON.stringify([s.inside.slice().sort(),s.revoked.slice().sort(),s.gate,s.grant]); }
function actions(s, scenario) {
  const out=[];
  for(const r of ROBOTS) if(!s.inside.includes(r.id)) {out.push({type:'scan',robot:r.id},{type:'enter',robot:r.id});}
  if(SCENARIOS[scenario].revoke) for(const r of ROBOTS) if(r.badge==='blue' && !s.inside.includes(r.id) && !s.revoked.includes(r.id)) out.push({type:'revoke',robot:r.id});
  return out;
}
export function search(policy, scenario='tailgate', rubric=defaultRubric('checkpoint')) {
  const r=validateRubric('checkpoint',rubric),p=validatePolicy(policy);
  if(!Object.hasOwn(SCENARIOS,scenario)) throw new Error('Unknown experiment.');
  const start=initialState(), queue=[{state:start,trace:[]}], seen=new Set([stateKey(start)]);
  let edges=0, longest=0;
  for(let cursor=0;cursor<queue.length;cursor++) {
    const current=queue[cursor]; longest=Math.max(longest,current.trace.length);
    if(violation(current.state,r)) return {found:true,trace:current.trace,states:cursor+1,discovered:seen.size,transitions:edges,scenario,policy:p,rubric:r,exhaustive:false,depth:current.trace.length};
    for(const action of actions(current.state,scenario)) {
      const step=transition(current.state,action,p,scenario,r);
      if(!step.allowed) continue;
      edges++;
      const key=stateKey(step.state);
      if(seen.has(key)) continue;
      seen.add(key); queue.push({state:step.state,trace:[...current.trace,{action,...step}]});
    }
  }
  return {found:false,trace:[],states:seen.size,discovered:seen.size,transitions:edges,scenario,policy:p,rubric:r,exhaustive:true,depth:longest};
}
export function searchAll(policy,rubric=defaultRubric('checkpoint')) { return Object.keys(SCENARIOS).map(s=>search(policy,s,rubric)); }
export function replay(trace, policy, scenario='tailgate', rubric=defaultRubric('checkpoint')) {
  let state=initialState();
  return trace.map(({action})=>{ const step=transition(state,action,policy,scenario,rubric); state=step.state; return {action,...step}; });
}
export function actionLabel(action) {
  const name=ROBOTS.find(r=>r.id===action.robot)?.name || action.robot;
  return `${name} ${action.type==='scan'?'scans':action.type==='enter'?'crosses':'loses badge'}`;
}
