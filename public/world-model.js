// A data-only finite-state interpreter for user-described worlds. No generated code executes.
const fail=message=>{throw new Error(message);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const text=(x,label,max=600)=>typeof x==='string'&&x.trim()&&x.trim().length<=max?x.trim():fail(`${label} must contain 1–${max} characters.`);
const list=(x,label,max=12)=>Array.isArray(x)&&x.length<=max?x:fail(`${label} must be a list of at most ${max} items.`);
const exact=(x,keys,label)=>{if(!object(x)||Object.keys(x).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(x,k)))fail(`${label} has missing or unknown fields.`);};
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,31}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x)?x:fail('Use simple, unique model identifiers.');
export function validateBrief(input,{complete=false}={}){
  exact(input,['world','actors','resources','rules','rubric'],'World description');
  const result={world:text(input.world,'World',600)};
  for(const k of ['actors','resources','rules','rubric'])result[k]=list(input[k],k).map(v=>text(v,k,k==='rules'||k==='rubric'?800:120));
  if(complete&&(!result.rules.length||!result.rubric.length))fail('Add at least one current rule and one rubric requirement before testing.');
  return result;
}
function checkPredicate(p,variables,depth=0,budget={remaining:100}){
  if(--budget.remaining<0)fail('A model condition is too complex.');
  if(depth>6)fail('A model condition is too deeply nested.');
  if(typeof p==='boolean')return p;
  if(!object(p))fail('A condition must be a comparison or a logical expression.');
  for(const group of ['all','any'])if(Object.hasOwn(p,group)){exact(p,[group],'Logical condition');const children=list(p[group],'Conditions',8);if(!children.length)fail('Logical conditions cannot be empty.');return {[group]:children.map(x=>checkPredicate(x,variables,depth+1,budget))};}
  if(Object.hasOwn(p,'not')){exact(p,['not'],'Negated condition');return {not:checkPredicate(p.not,variables,depth+1,budget)};}
  exact(p,['variable','op','value'],'Comparison');
  const variable=variables.find(v=>v.id===p.variable);if(!variable)fail('A condition references an unknown variable.');
  if(!['eq','neq','lt','lte','gt','gte'].includes(p.op))fail('Unknown comparison operator.');
  if(typeof p.value!==typeof variable.values[0]||!['string','boolean','number'].includes(typeof p.value))fail('A comparison has the wrong value type.');
  if(typeof p.value==='number'&&(!Number.isFinite(p.value)||Math.abs(p.value)>10000))fail('A comparison has an invalid number.');
  if(typeof p.value==='string'&&p.value.length>120)fail('A comparison value is too long.');
  if(!['eq','neq'].includes(p.op)&&typeof p.value!=='number')fail('Ordering comparisons require numeric variables.');
  return {variable:variable.id,op:p.op,value:p.value};
}
export function validateAnalysis(input,rawBrief){
  const brief=validateBrief(rawBrief,{complete:true});
  if(!object(input)||!['simulation','review'].includes(input.mode))fail('The analysis did not choose a supported review mode.');
  const common={mode:input.mode,explanation:text(input.explanation,'Analysis explanation',1800)};
  if(input.mode==='review'){
    exact(input,['mode','explanation','assessments'],'AI review');
    const assessments=list(input.assessments,'Assessments');
    if(assessments.length!==brief.rubric.length)fail('AI review must address every rubric requirement.');
    const seen=new Set();
    return {...common,assessments:assessments.map(a=>{
      exact(a,['rubricIndex','status','scenario','reasoning','suggestedRevision'],'Rubric assessment');
      if(!Number.isInteger(a.rubricIndex)||a.rubricIndex<0||a.rubricIndex>=brief.rubric.length||seen.has(a.rubricIndex))fail('AI review has incomplete rubric coverage.');seen.add(a.rubricIndex);
      if(!['potential_gap','needs_clarification','no_obvious_gap'].includes(a.status))fail('AI review cannot claim a proven verdict.');
      return {rubricIndex:a.rubricIndex,status:a.status,scenario:text(a.scenario,'Scenario',1800),reasoning:text(a.reasoning,'Reasoning',1800),suggestedRevision:text(a.suggestedRevision,'Suggested revision',1000)};
    })};
  }
  exact(input,['mode','explanation','assumptions','variables','actions','criteria'],'Simulation');
  const assumptions=list(input.assumptions,'Model assumptions',10).map(v=>text(v,'Model assumption',800));
  const seen=new Set();
  const variables=list(input.variables,'Variables',10).map(v=>{
    exact(v,['id','label','values','initial'],'Variable');const key=id(v.id);if(seen.has(key))fail('Duplicate model variable.');seen.add(key);
    const values=list(v.values,'Variable values',12);if(values.length<2||new Set(values).size!==values.length)fail('A variable needs 2–12 distinct values.');
    for(const value of values){if(!['number','string','boolean'].includes(typeof value)||typeof value!==typeof values[0])fail('Variable values must have one primitive type.');if(typeof value==='number'&&(!Number.isInteger(value)||Math.abs(value)>1000))fail('Numeric model values must be small integers.');if(typeof value==='string'&&(!value||value.length>120))fail('Model value names must be short.');}
    if(!values.includes(v.initial))fail('A variable starts outside its declared values.');
    return {id:key,label:text(v.label,'Variable label',120),values:[...values],initial:v.initial};
  });
  if(!variables.length)fail('A simulation needs at least one changing fact.');
  const actionIds=new Set(),coveredRules=new Set();
  const actions=list(input.actions,'Actions',14).map(a=>{
    exact(a,['id','label','ruleIndexes','when','effects'],'Action');const key=id(a.id);if(actionIds.has(key))fail('Duplicate action identifier.');actionIds.add(key);
    const ruleIndexes=list(a.ruleIndexes,'Rule references');if(!ruleIndexes.length)fail('Each action must reference its source rule.');for(const n of ruleIndexes){if(!Number.isInteger(n)||n<0||n>=brief.rules.length)fail('An action references an unknown rule.');coveredRules.add(n);}
    const writes=new Set();const effects=list(a.effects,'Action effects',10).map(e=>{
      if(!object(e)||!Object.hasOwn(e,'variable'))fail('Invalid action effect.');
      const variable=variables.find(v=>v.id===e.variable);if(!variable||writes.has(e.variable))fail('An effect has an unknown or repeated variable.');writes.add(e.variable);
      if(Object.hasOwn(e,'set')){exact(e,['variable','set'],'Assignment');if(!variable.values.includes(e.set))fail('An effect assigns a value outside the model.');return {variable:variable.id,set:e.set};}
      exact(e,['variable','add'],'Increment');if(typeof variable.initial!=='number'||!Number.isInteger(e.add)||e.add===0||Math.abs(e.add)>1000)fail('An increment must change a numeric variable.');return {variable:variable.id,add:e.add};
    });
    if(!effects.length)fail('An action needs an effect.');
    return {id:key,label:text(a.label,'Action label',160),ruleIndexes:[...ruleIndexes],when:checkPredicate(a.when,variables),effects};
  });
  if(!actions.length||coveredRules.size!==brief.rules.length)fail('The model must cover every current rule.');
  const coverage=new Set();const criteria=list(input.criteria,'Criteria').map(c=>{
    exact(c,['rubricIndex','holds'],'Criterion');if(!Number.isInteger(c.rubricIndex)||c.rubricIndex<0||c.rubricIndex>=brief.rubric.length||coverage.has(c.rubricIndex))fail('Invalid or duplicate rubric criterion.');coverage.add(c.rubricIndex);
    if(typeof c.holds==='boolean')fail('Rubric criteria must test modeled facts, not constant verdicts.');return {rubricIndex:c.rubricIndex,holds:checkPredicate(c.holds,variables)};
  });
  if(coverage.size!==brief.rubric.length)fail('The model must cover every rubric requirement.');
  return {...common,assumptions,variables,actions,criteria};
}
export function evaluatePredicate(p,state){
  if(typeof p==='boolean')return p;
  if(p.all)return p.all.every(x=>evaluatePredicate(x,state));
  if(p.any)return p.any.some(x=>evaluatePredicate(x,state));
  if(p.not!==undefined)return !evaluatePredicate(p.not,state);
  const a=state[p.variable],b=p.value;
  switch(p.op){case 'eq':return a===b;case 'neq':return a!==b;case 'lt':return a<b;case 'lte':return a<=b;case 'gt':return a>b;case 'gte':return a>=b;default:throw new Error('Unknown condition.');}
}
export const worldInitial=model=>Object.fromEntries(model.variables.map(v=>[v.id,v.initial]));
export const worldViolations=(model,state)=>model.criteria.filter(c=>!evaluatePredicate(c.holds,state)).map(c=>c.rubricIndex);
export function worldStep(model,state,actionId){
  const action=model.actions.find(a=>a.id===actionId);if(!action)return {state:{...state},allowed:false,reason:'Unknown action.'};
  if(!evaluatePredicate(action.when,state))return {state:{...state},allowed:false,reason:'The applied rule does not permit this action in the current state.'};
  const next={...state};
  for(const e of action.effects){const value=Object.hasOwn(e,'set')?e.set:state[e.variable]+e.add;const variable=model.variables.find(v=>v.id===e.variable);if(!variable.values.includes(value))return {state:{...state},allowed:false,boundary:true,reason:'This action would leave the reviewed model bounds.'};next[e.variable]=value;}
  return {state:next,allowed:true,reason:action.label,violations:worldViolations(model,next)};
}
export function worldSearch(model,{maxStates=6000,maxDepth=24}={}){
  if(!Number.isInteger(maxStates)||maxStates<1||maxStates>6000||!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>24)fail('Invalid search limits.');
  const initial=worldInitial(model),queue=[{state:initial,parent:-1,move:null,depth:0}],seen=new Set([JSON.stringify(initial)]);
  let transitions=0,truncated=false,boundaries=0;
  for(let cursor=0;cursor<queue.length;cursor++){
    const node=queue[cursor],violations=worldViolations(model,node.state);
    if(violations.length){const trace=[];for(let i=cursor;queue[i].parent!==-1;i=queue[i].parent)trace.push(queue[i].move);return {found:true,exhaustive:false,truncated,states:cursor+1,transitions,boundaries,violations,trace:trace.reverse(),limits:{maxStates,maxDepth}};}
    for(const action of model.actions){const move=worldStep(model,node.state,action.id);if(move.boundary)boundaries++;if(!move.allowed)continue;transitions++;const key=JSON.stringify(move.state);if(seen.has(key))continue;if(node.depth>=maxDepth||queue.length>=maxStates){truncated=true;continue;}seen.add(key);queue.push({state:move.state,parent:cursor,move:{action:action.id,label:action.label,...move},depth:node.depth+1});}
  }
  return {found:false,exhaustive:!truncated,truncated,states:seen.size,transitions,boundaries,violations:[],trace:[],limits:{maxStates,maxDepth}};
}
export function worldReplay(model,trace){let state=worldInitial(model);return trace.map(t=>{const move=worldStep(model,state,t.action);state=move.state;return {action:t.action,label:model.actions.find(a=>a.id===t.action)?.label||t.label,...move};});}
export function describePredicate(p,model){
  if(typeof p==='boolean')return p?'Always':'Never';
  if(p.all)return '('+p.all.map(x=>describePredicate(x,model)).join(' and ')+')';
  if(p.any)return '('+p.any.map(x=>describePredicate(x,model)).join(' or ')+')';
  if(p.not!==undefined)return 'Not '+describePredicate(p.not,model);
  const ops={eq:'is',neq:'is not',lt:'is below',lte:'is at most',gt:'is above',gte:'is at least'};
  return `${model.variables.find(v=>v.id===p.variable)?.label||p.variable} ${ops[p.op]} ${String(p.value)}`;
}
