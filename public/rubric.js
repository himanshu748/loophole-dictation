// Rubrics define success independently of the policy that permits actions.
const FIELDS = {
  coupons:[
    {key:'newOnly',label:'Customer eligibility',options:{true:'New customers only',false:'New or existing customers'},type:'boolean'},
    {key:'perCustomer',label:'Maximum discounts per customer',options:{0:'No customer limit',1:'1 discount',2:'2 discounts',3:'3 discounts'},type:'number'},
    {key:'perOrder',label:'Maximum discounts per order',options:{0:'No order limit',1:'1 discount'},type:'number'},
  ],
  approvals:[
    {key:'independent',label:'Independent reviewer',options:{true:'Required',false:'Author may approve'},type:'boolean'},
    {key:'currentVersion',label:'Approval of published version',options:{true:'Required',false:'An earlier version is enough'},type:'boolean'},
    {key:'activeApproval',label:'Approval still active at publication',options:{true:'Required',false:'Withdrawn approval is acceptable'},type:'boolean'},
  ],
  checkpoint:[
    {key:'badge',label:'Badge permitted inside',options:{blue:'Blue only',red:'Red only',any:'Either color'},type:'string'},
    {key:'unrevoked',label:'Badge must not be revoked',options:{true:'Required',false:'Revoked badges are acceptable'},type:'boolean'},
    {key:'capacity',label:'Maximum robots inside',options:{1:'1 robot',2:'2 robots'},type:'number'},
  ],
};
const DEFAULTS={
  coupons:{name:'New-customer offer',newOnly:true,perCustomer:1,perOrder:0},
  approvals:{name:'Independent current review',independent:true,currentVersion:true,activeApproval:true},
  checkpoint:{name:'Valid blue badges',badge:'blue',unrevoked:true,capacity:2},
};
export function rubricFields(world){if(!Object.hasOwn(FIELDS,world))throw new Error('Unknown rubric world.');return FIELDS[world];}
export function defaultRubric(world){rubricFields(world);return {...DEFAULTS[world]};}
export function validateRubric(world,input){
  const fields=rubricFields(world);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==fields.length+1)throw new Error('The rubric is incomplete or contains unknown criteria.');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80)throw new Error('Give your rubric a name between 1 and 80 characters.');
  const r={name:input.name.trim()};
  for(const f of fields){const value=input[f.key];if(typeof value!==f.type||!Object.hasOwn(f.options,String(value)))throw new Error(`Choose a supported value for ${f.label.toLowerCase()}.`);r[f.key]=value;}
  if((world==='coupons'&&!r.newOnly&&!r.perCustomer&&!r.perOrder)||(world==='approvals'&&!r.independent&&!r.currentVersion&&!r.activeApproval)||(world==='checkpoint'&&r.badge==='any'&&!r.unrevoked&&r.capacity===2))throw new Error('Keep at least one testable requirement in your rubric.');
  return r;
}
export function rubricText(world,input){
  const r=validateRubric(world,input),parts=[];
  if(world==='coupons'){
    if(r.newOnly)parts.push('Only new customers receive discounts');
    if(r.perCustomer)parts.push(`at most ${r.perCustomer} discount${r.perCustomer===1?'':'s'} per customer`);
    if(r.perOrder)parts.push('at most one discount per order');
  }else if(world==='approvals'){
    if(r.independent)parts.push('Publish only with an independent review');
    if(r.currentVersion)parts.push('approval must cover the published version');
    if(r.activeApproval)parts.push('approval must still be active at publication');
  }else{
    if(r.badge!=='any')parts.push(`Only ${r.badge} badges may be inside`);
    if(r.unrevoked)parts.push('badges inside must not be revoked');
    if(r.capacity===1)parts.push('at most one robot may be inside');
  }
  const text=parts.join('; ');return text.charAt(0).toUpperCase()+text.slice(1)+'.';
}
