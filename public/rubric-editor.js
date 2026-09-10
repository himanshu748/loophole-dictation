import {defaultRubric,rubricFields,rubricText,validateRubric} from './rubric.js';
const escape=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export function mountRubricEditor(world,initial,onApply,isLocked=()=>false){
  const root=document.getElementById('rubric-editor');
  let applied=validateRubric(world,initial);
  const fields=rubricFields(world);
  root.innerHTML=`<div class="rubric-heading"><strong>Your rubric</strong><span id="rubric-active-name"></span></div><p id="rubric-active-text"></p><details id="rubric-details"><summary>Create or edit your rubric</summary><p class="rubric-help">Your rule controls what is allowed. Your rubric defines success. Every selected requirement must hold in the modeled test cases.</p><label for="rubric-name">Rubric name</label><input id="rubric-name" maxlength="80" autocomplete="off">${fields.map(f=>`<label for="rubric-${f.key}">${escape(f.label)}</label><select id="rubric-${f.key}">${Object.entries(f.options).map(([v,label])=>`<option value="${escape(v)}">${escape(label)}</option>`).join('')}</select>`).join('')}<p class="rubric-help">These criteria use the world's modeled facts. Timers, custom objects and external systems are outside this search.</p><p id="rubric-status" role="status"></p><div class="rubric-buttons"><button id="rubric-apply" class="button dark">Apply rubric & retest</button><button id="rubric-reset" class="button quiet">Load default rubric</button></div></details>`;
  const $=id=>document.getElementById(id);
  function fill(r){$('rubric-name').value=r.name;for(const f of fields)$('rubric-'+f.key).value=String(r[f.key]);}
  function render(){ $('rubric-active-name').textContent=applied.name;$('rubric-active-text').textContent=rubricText(world,applied);fill(applied); }
  const draft=()=>$('rubric-status').textContent='Draft rubric. Apply it to recalculate the results.';
  $('rubric-name').addEventListener('input',draft);
  for(const f of fields)$('rubric-'+f.key).addEventListener('change',draft);
  $('rubric-reset').addEventListener('click',()=>{if(isLocked())return;fill(defaultRubric(world));draft();});
  $('rubric-apply').addEventListener('click',()=>{
    if(isLocked())return;
    try{
      const candidate={name:$('rubric-name').value};
      for(const f of fields){const value=$('rubric-'+f.key).value;candidate[f.key]=f.type==='boolean'?value==='true':f.type==='number'?Number(value):value;}
      const next=validateRubric(world,candidate);onApply(next);applied=next;render();
      $('rubric-status').textContent='Rubric applied. Results recalculated using the applied rule.';
    }catch(e){$('rubric-status').textContent=e.message;}
  });
  render();
}
