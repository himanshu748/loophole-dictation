import test from 'node:test';
import assert from 'node:assert/strict';
import {compareWorlds} from '../public/world-comparison.js';

const eq=(variable,value)=>({variable,op:'eq',value});
function simulation(){
  return {version:1,brief:{world:'A tool library',actors:['Member'],resources:['Tools'],rules:['Members can borrow an available tool.'],rubric:['Each member may borrow at most one tool.']},analysis:{mode:'simulation',explanation:'A bounded borrowing count.',assumptions:['One member and two tools.'],variables:[{id:'borrowed',label:'Borrowed tools',values:[0,1,2],initial:0}],actions:[{id:'borrow',label:'Borrow a tool',ruleIndexes:[0],when:true,effects:[{variable:'borrowed',add:1}]}],criteria:[{rubricIndex:0,holds:{variable:'borrowed',op:'lte',value:1}}]}};
}
function critique(){
  const bundle=simulation();
  bundle.analysis={mode:'review',explanation:'The policy needs clarification.',assessments:[{rubricIndex:0,status:'potential_gap',scenario:'A member borrows another tool.',reasoning:'No borrowing limit appears in the rule.',suggestedRevision:'State an explicit borrowing limit.'}]};
  return bundle;
}

test('the first version has no prior verdict and lists its rules and rubric as additions',()=>{
  const current=simulation(),result=compareWorlds(null,current);
  assert.equal(result.before,null);
  assert.deepEqual(result.rules,{added:current.brief.rules,removed:[]});
  assert.deepEqual(result.rubric,{added:current.brief.rubric,removed:[]});
  assert.equal(result.sameRubric,false);
  assert.equal(result.modelChanged,false);
  assert.equal(result.modeChanged,false);
  assert.equal(result.replayCompatible,false);
  assert.equal(result.after.found,true);
  assert.equal(result.after.trace.length,2);
  assert.match(result.note,/first reviewed version/);
  assert.deepEqual(compareWorlds(undefined,current),result);
});

test('a weaker rubric is flagged even if the current search no longer finds a violation',()=>{
  const previous=simulation(),current=simulation();
  current.brief.rubric=['Each member may borrow at most two tools.'];
  current.analysis.criteria[0].holds.value=2;
  const result=compareWorlds(previous,current);
  assert.equal(result.sameRubric,false);
  assert.equal(result.modelChanged,true);
  assert.deepEqual(result.rubric,{added:current.brief.rubric,removed:previous.brief.rubric});
  assert.equal(result.before.found,true);
  assert.equal(result.after.found,false);
  assert.equal(result.after.exhaustive,true);
  assert.match(result.note,/not proof of a fix/);
  assert.match(result.note,/do not test the same requirements/);
});

test('changing only a state domain changes the model and cannot be presented as a proven repair',()=>{
  const previous=simulation(),current=simulation();
  current.analysis.variables[0].values=[0,1];
  const result=compareWorlds(previous,current);
  assert.equal(result.sameRubric,true);
  assert.equal(result.modelChanged,true);
  assert.equal(result.before.found,true);
  assert.equal(result.after.found,false);
  assert.equal(result.after.boundaries,1);
  assert.match(result.note,/not proof of a fix/);
});

test('initial values, assumptions, action semantics and criterion predicates affect model identity',()=>{
  const changes=[
    bundle=>{bundle.analysis.variables[0].initial=1;},
    bundle=>{bundle.analysis.assumptions=['One member and exactly two available tools.'];},
    bundle=>{bundle.analysis.actions[0].when=eq('borrowed',0);},
    bundle=>{bundle.analysis.actions[0].effects=[{variable:'borrowed',set:1}];},
    bundle=>{bundle.analysis.criteria[0].holds.value=0;}
  ];
  for(const change of changes){const current=simulation();change(current);assert.equal(compareWorlds(simulation(),current).modelChanged,true);}
});

test('a simulation becoming critique has no numeric search verdict and no replay',()=>{
  const result=compareWorlds(simulation(),critique());
  assert.equal(result.modeChanged,true);
  assert.equal(result.modelChanged,true);
  assert.equal(result.replayCompatible,false);
  assert.equal(result.before.mode,'simulation');
  assert.equal(result.after.mode,'review');
  assert.equal(result.after.found,null);
  assert.equal(result.after.exhaustive,null);
  assert.equal(result.after.states,null);
  assert.equal(result.after.assessments.length,1);
  assert.match(result.note,/do not provide equivalent evidence/);
});

test('a zero-action initial-state violation is not offered as a replayable trace',()=>{
  const previous=simulation();previous.analysis.variables[0].initial=2;
  const result=compareWorlds(previous,simulation());
  assert.equal(result.before.found,true);
  assert.equal(result.before.trace.length,0);
  assert.deepEqual(result.before.violations,[0]);
  assert.equal(result.replayCompatible,false);
});

test('the previous shortest counterexample can replay when its action ids and labels remain',()=>{
  const previous=simulation(),current=simulation();
  current.analysis.actions[0].when=eq('borrowed',0);
  const result=compareWorlds(previous,current);
  assert.equal(result.before.trace.length,2);
  assert.equal(result.replayCompatible,true);
  assert.equal(result.modelChanged,true);
  assert.equal(result.after.found,false);
});

test('renaming or removing an old counterexample action disables replay compatibility',()=>{
  for(const change of [bundle=>{bundle.analysis.actions[0].label='Take a tool';},bundle=>{bundle.analysis.actions[0].id='take';}]){
    const current=simulation();change(current);
    assert.equal(compareWorlds(simulation(),current).replayCompatible,false);
  }
});

test('a simulation with no earlier counterexample has nothing to replay',()=>{
  const previous=simulation();previous.analysis.actions[0].when=eq('borrowed',0);
  const result=compareWorlds(previous,simulation());
  assert.equal(result.before.found,false);
  assert.equal(result.before.exhaustive,true);
  assert.equal(result.replayCompatible,false);
});

test('fresh searches ignore stored results and comparison does not mutate input',()=>{
  const previous=simulation(),current=simulation();
  previous.result={found:false,states:9999,trace:[]};
  current.result={found:false,states:9999,trace:[]};
  const saved=structuredClone({previous,current});
  const result=compareWorlds(previous,current);
  assert.equal(result.before.found,true);
  assert.equal(result.after.found,true);
  assert.equal(result.before.states,3);
  assert.equal(result.after.states,3);
  assert.equal(result.sameRubric,true);
  assert.equal(result.modelChanged,false);
  assert.deepEqual({previous,current},saved);
});

test('object-key order and descriptive explanation do not change the model signature',()=>{
  const current=simulation();
  current.analysis.explanation='An alternative explanation of the same count.';
  current.analysis.variables[0]={initial:0,values:[0,1,2],label:'Borrowed tools',id:'borrowed'};
  assert.equal(compareWorlds(simulation(),current).modelChanged,false);
});

test('rule differences preserve duplicate counts',()=>{
  const previous=simulation(),current=simulation();
  current.brief.rules.push(current.brief.rules[0]);
  current.analysis.actions[0].ruleIndexes=[0,1];
  const result=compareWorlds(previous,current);
  assert.deepEqual(result.rules,{added:[current.brief.rules[0]],removed:[]});
});

test('invalid bundles are rejected rather than compared as trusted evidence',()=>{
  const invalid=simulation();invalid.analysis.variables[0].initial=100;
  assert.throws(()=>compareWorlds(simulation(),invalid),/outside its declared values/);
  assert.throws(()=>compareWorlds(invalid,simulation()),/outside its declared values/);
});
