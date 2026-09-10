import { validatePolicy, describePolicy } from './engine.js';
import {domainFor,domainText,validateDomainPolicy,domainMeaning} from './domains.js';
export function validateDomain(domain='checkpoint') {
  if(domain!=='checkpoint')domainFor(domain);
  return domain;
}
export const EXAMPLES = [
  {name:'Open on blue',text:'Open the gate when a robot with a blue badge arrives.',policy:{trigger:'blue',passage:'shared',recheck:false}},
  {name:'One at a time',text:'Open the gate for a blue badge. Close it after one robot passes.',policy:{trigger:'blue',passage:'single',recheck:false}},
  {name:'Only the badge holder',text:'Let only the robot that scanned a blue badge cross. Close the gate behind it.',policy:{trigger:'blue',passage:'bound',recheck:false}},
  {name:'Check at crossing',text:'Allow exactly one robot through per valid blue badge. Everyone else waits. Check that its badge is still valid when it crosses.',policy:{trigger:'blue',passage:'bound',recheck:true}},
];
export function normalize(text) { return text.toLowerCase().replace(/[.,!?;:“”"']/g,' ').replace(/\s+/g,' ').trim(); }
// Deliberately narrow local vocabulary. Other wording goes to the server compiler;
// an unavailable model never silently approximates an arbitrary user rule.
export function compileExample(text,domain='checkpoint') {
  validateDomain(domain);
  if(domain!=='checkpoint') {
    const d=domainFor(domain);
    const policy=[d.starter,d.fixed].find(p=>normalize(domainText(domain,p))===normalize(text));
    return policy?{policy:{...policy},interpretation:domainMeaning(domain,policy),source:'example',notes:[]}:null;
  }
  const entry=EXAMPLES.find(x=>normalize(x.text)===normalize(text));
  return entry ? {policy:{...entry.policy},interpretation:describePolicy(entry.policy),source:'example',notes:[]} : null;
}
export function validateCompilation(data,domain='checkpoint') {
  if(!data || data.supported!==true) throw new Error(typeof data?.reason==='string'?data.reason:'This rule needs clarification. Describe badges, who may cross, and when the gate closes.');
  const policy=domain==='checkpoint'?validatePolicy(data.policy):validateDomainPolicy(domain,data.policy);
  if(!Array.isArray(data.assumptions) || !data.assumptions.every(x=>typeof x==='string')) throw new Error('The rule interpretation was incomplete. Please try again.');
  return {policy,interpretation:domain==='checkpoint'?describePolicy(policy):domainMeaning(domain,policy),notes:data.assumptions.slice(0,5),source:'ai'};
}
