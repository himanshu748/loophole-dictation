import {defaultRubric,validateRubric} from './rubric.js';
// Small, inspectable business-rule models. Search and replay never call an LLM.
export const DOMAINS = {
  coupons: {
    name:'Coupon redemption', title:'One offer. More than one way to use it.',
    goal:'Only new customers receive a discount, at most once per customer.',
    bounds:'Two customers, three orders, at most two redemptions per order, and one eligibility change. Discount amounts, payments and identity changes are outside this model.',
    fields:[
      {key:'eligibility',label:'Who qualifies',options:{new:'New customers',any:'Any customer'}},
      {key:'limit',label:'Redemption limit',options:{none:'No limit',order:'Once per order',customer:'Once per customer'}},
      {key:'recheck',label:'Eligibility checked',options:{false:'When the code is applied',true:'At application and checkout'}},
    ],
    starter:{eligibility:'new',limit:'order',recheck:false},
    fixed:{eligibility:'new',limit:'customer',recheck:true},
    scenarios:{repeat:{name:'Repeat redemption',detail:'Alex applies the offer to two orders before checking out.'},existing:{name:'Existing customer',detail:'Sam has already purchased. Can Sam receive the new-customer offer?'},changed:{name:'Eligibility changes',detail:'Alex makes another purchase after applying the code, before checkout.'}},
    text:p=>`Offer a discount to ${p.eligibility==='new'?'new customers':'any customer'}. ${p.limit==='none'?'Allow repeated redemption without a limit.':p.limit==='order'?'Allow one redemption per order.':'Allow one redemption per customer.'} Check eligibility ${p.recheck?'both when applying the code and at checkout':'only when applying the code'}.`,
  },
  approvals: {
    name:'Document approval', title:'Approved yesterday. Changed today.',
    goal:'Publish only the current version, approved by someone other than its author, with approval still valid.',
    bounds:'One document, two versions, an author and one reviewer. Approval may be withdrawn once. Role changes, deadlines and multiple documents are outside this model.',
    fields:[
      {key:'reviewer',label:'Who may approve',options:{any:'Author or reviewer',other:'Someone other than the author'}},
      {key:'binding',label:'Approval applies to',options:{document:'The document, even after edits',version:'Only the reviewed version'}},
      {key:'recheck',label:'Approval checked',options:{false:'When approval is granted',true:'Again when publishing'}},
    ],
    starter:{reviewer:'other',binding:'document',recheck:false},
    fixed:{reviewer:'other',binding:'version',recheck:true},
    scenarios:{self:{name:'Self approval',detail:'Can Maya approve and publish her own draft?'},edited:{name:'Edited after review',detail:'Noah approves version 1. Maya may edit it before publishing.'},withdrawn:{name:'Approval withdrawn',detail:'Noah may withdraw approval before the document is published.'}},
    text:p=>`${p.reviewer==='other'?'Require approval from someone other than the author.':'Allow the author or reviewer to approve.'} Approval applies to ${p.binding==='version'?'only the reviewed version':'the document even after edits'}. ${p.recheck?'Check that approval is still valid when publishing.':'Check approval only when it is granted.'}`,
  },
};
export function domainFor(id) {if(!Object.hasOwn(DOMAINS,id))throw new Error('Unknown rule world.');return DOMAINS[id];}
export function validateDomainPolicy(id,policy) {
  const d=domainFor(id);
  if(!policy||typeof policy!=='object'||Array.isArray(policy)||Object.keys(policy).length!==d.fields.length)throw new Error('The rule interpretation is incomplete.');
  const result={};
  for(const f of d.fields) {
    const v=policy[f.key];
    if(!Object.hasOwn(f.options,String(v))||(f.key==='recheck'?typeof v!=='boolean':typeof v!=='string'))throw new Error(`Unsupported value for ${f.label.toLowerCase()}.`);
    result[f.key]=v;
  }
  return result;
}
export function domainMeaning(id,policy) {const p=validateDomainPolicy(id,policy);return domainFor(id).fields.map(f=>({label:f.label,value:f.options[String(p[f.key])]}));}
export function domainText(id,policy) {return domainFor(id).text(validateDomainPolicy(id,policy));}
export function domainInitial(id) {
  domainFor(id);
  return id==='coupons'?{applied:[],redemptions:[0,0,0],eligible:[true,false],otherPurchase:false,breach:null}:{version:1,approval:null,withdrawn:false,published:false,breach:null};
}
const orders=[{name:'Alex · order A',customer:0},{name:'Alex · order B',customer:0},{name:'Sam · order C',customer:1}];
export function domainActions(id,scenario) {
  const d=domainFor(id);if(!Object.hasOwn(d.scenarios,scenario))throw new Error('Unknown experiment.');
  if(id==='coupons') {
    const ids=scenario==='existing'?[2]:scenario==='changed'?[0]:[0,1];
    return [...ids.flatMap(order=>[{type:'apply',order,label:`Apply code · ${orders[order].name}`},{type:'redeem',order,label:`Checkout · ${orders[order].name}`}]),...(scenario==='changed'?[{type:'purchase',label:'Alex makes another purchase'}]:[])];
  }
  return [
    ...(scenario==='self'?[{type:'approve',actor:'author',label:'Maya approves her own draft'}]:[]),
    {type:'approve',actor:'reviewer',label:'Noah approves the current version'},
    ...(scenario==='edited'?[{type:'edit',label:'Maya edits the document'}]:[]),
    ...(scenario==='withdrawn'?[{type:'withdraw',label:'Noah withdraws approval'}]:[]),
    {type:'publish',label:'Maya publishes the document'},
  ];
}
export function domainStep(id,state,action,policy,scenario,rubric=defaultRubric(id)) {
  const p=validateDomainPolicy(id,policy),r=validateRubric(id,rubric),s=structuredClone(state);
  const canonical=domainActions(id,scenario).find(a=>a.type===action?.type&&a.actor===action?.actor&&a.order===action?.order);
  const blocked=explanation=>({state:s,allowed:false,explanation});
  const passed=explanation=>({state:s,allowed:true,explanation});
  if(!canonical)return blocked('This action is not part of the experiment.');
  if(s.breach)return blocked('The goal is already broken. Reset to try another sequence.');
  if(id==='coupons') {
    if(action.type==='purchase') {
      if(s.otherPurchase)return blocked('The other purchase has already happened.');
      s.otherPurchase=true;s.eligible[0]=false;return passed('Alex completes another purchase and is no longer a new customer.');
    }
    const i=action.order,order=orders[i],customer=order.customer;
    if(action.type==='apply') {
      if(s.applied.includes(i))return blocked('The code is already applied to this order.');
      if(p.eligibility==='new'&&!s.eligible[customer])return blocked(`${order.name}: this customer is no longer new.`);
      s.applied.push(i);s.applied.sort();return passed(`${order.name}: the code is accepted for checkout.`);
    }
    if(!s.applied.includes(i))return blocked('Apply the code to this order first.');
    if(s.redemptions[i]>=2)return blocked('This experiment stops at two redemptions per order.');
    const used=s.redemptions.reduce((n,count,j)=>n+(orders[j].customer===customer?count:0),0);
    if(p.limit==='order'&&s.redemptions[i]>0)return blocked('This order has already redeemed the offer.');
    if(p.limit==='customer'&&used>0)return blocked('This customer has already redeemed the offer.');
    if(p.recheck&&p.eligibility==='new'&&!s.eligible[customer])return blocked('Checkout checks again: this customer is no longer new.');
    const wasEligible=s.eligible[customer];s.redemptions[i]++;s.eligible[customer]=false;
    if(r.perCustomer&&used+1>r.perCustomer)s.breach=r.perCustomer===1?'The same customer received the discount more than once.':`The same customer received more than ${r.perCustomer} discounts.`;
    else if(r.perOrder&&s.redemptions[i]>r.perOrder)s.breach='The same order received more than one discount.';
    else if(r.newOnly&&!wasEligible)s.breach='An existing customer received a new-customer discount.';
    return passed(s.breach||`${order.name}: one discount redeemed.`);
  }
  if(s.published)return blocked('The document is already published.');
  if(action.type==='approve') {
    if(p.reviewer==='other'&&action.actor==='author')return blocked('Maya cannot approve her own document.');
    if(s.approval?.version===s.version&&s.approval?.actor===action.actor&&!s.withdrawn)return blocked('This approval is already recorded.');
    // A withdrawn approval is terminal here; a second review is outside this scenario.
    if(s.withdrawn)return blocked('This experiment models one withdrawal; start over for a new review.');
    s.approval={version:s.version,actor:action.actor};return passed(`${action.actor==='author'?'Maya':'Noah'} approves version ${s.version}.`);
  }
  if(action.type==='edit') {if(s.version===2)return blocked('This experiment has two versions.');s.version=2;return passed('Maya saves version 2. The existing approval still records the version it reviewed.');}
  if(action.type==='withdraw') {if(!s.approval||s.withdrawn)return blocked('There is no active approval to withdraw.');s.withdrawn=true;return passed('Noah withdraws approval.');}
  if(!s.approval)return blocked('The document needs an approval before publishing.');
  if(p.binding==='version'&&s.approval.version!==s.version)return blocked('Version 2 has not been approved. Review the current version first.');
  if(p.recheck&&s.withdrawn)return blocked('Publishing checks again: approval has been withdrawn.');
  s.published=true;
  if(r.independent&&s.approval.actor==='author')s.breach='The author published without an independent review.';
  else if(r.currentVersion&&s.approval.version!==s.version)s.breach='An unreviewed version was published using an older approval.';
  else if(r.activeApproval&&s.withdrawn)s.breach='The document was published after approval was withdrawn.';
  return passed(s.breach||`Version ${s.version} is published and meets the selected rubric.`);
}
export function domainSearch(id,policy,scenario,rubric=defaultRubric(id)) {
  const r=validateRubric(id,rubric),p=validateDomainPolicy(id,policy),actions=domainActions(id,scenario),start=domainInitial(id);
  const queue=[{state:start,trace:[]}],seen=new Set([JSON.stringify(start)]);let transitions=0;
  for(let cursor=0;cursor<queue.length;cursor++) {
    const current=queue[cursor];
    if(current.state.breach)return {domain:id,scenario,policy:p,rubric:r,found:true,trace:current.trace,states:cursor+1,transitions,exhaustive:false};
    for(const action of actions) {
      const step=domainStep(id,current.state,action,p,scenario,r);if(!step.allowed)continue;transitions++;
      const key=JSON.stringify(step.state);if(seen.has(key))continue;seen.add(key);queue.push({state:step.state,trace:[...current.trace,{action,...step}]});
    }
  }
  return {domain:id,scenario,policy:p,rubric:r,found:false,trace:[],states:seen.size,transitions,exhaustive:true};
}
export function domainSearchAll(id,policy,rubric=defaultRubric(id)) {return Object.keys(domainFor(id).scenarios).map(s=>domainSearch(id,policy,s,rubric));}
export function domainReplay(id,trace,policy,scenario,rubric=defaultRubric(id)) {let state=domainInitial(id);return trace.map(({action})=>{const step=domainStep(id,state,action,policy,scenario,rubric);state=step.state;return {action,...step};});}
export function domainSnapshot(id,s) {
  if(id==='coupons')return [
    {label:'Alex',value:s.eligible[0]?'New customer':'Existing customer',detail:`${s.redemptions[0]+s.redemptions[1]} discounts received`},
    {label:'Sam',value:'Existing customer',detail:`${s.redemptions[2]} discounts received`},
    ...orders.map((o,i)=>({label:o.name,value:s.redemptions[i]?`${s.redemptions[i]} redeemed`:s.applied.includes(i)?'Code applied':'No code',detail:s.applied.includes(i)?'Accepted at application':'Waiting'})),
  ];
  return [{label:'Maya’s document',value:`Version ${s.version}`,detail:s.published?'Published':'Draft'},
    {label:'Review record',value:s.approval?`${s.approval.actor==='author'?'Maya':'Noah'} · version ${s.approval.version}`:'No approval',detail:s.withdrawn?'Withdrawn':s.approval?'Active':'Waiting for review'}];
}
