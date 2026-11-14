import {test,expect} from '@playwright/test';
import {createAiCollectionFixture} from '../helpers/ai-collection-fixture.mjs';
import {businessFields,memberFields,stateChoices,priorityChoices} from '../helpers/ai-field-choices.mjs';

test('browser receives native AI field choices while hidden fields and denied collections stay hidden',async({page})=>{
  const f=await createAiCollectionFixture({businessFields,memberFields});let accepted=false;
  try{
    await page.goto(f.origin+'/health');
    const inspect=()=>page.evaluate(async({adminEmail,memberEmail,password,collection})=>{
      async function describe(email){
        const login=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
        if(login.status!==200)throw Error('Native login failed');
        const {data:{access_token}}=await login.json();
        const response=await fetch('/extensions/ai-scope-probe/tool',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+access_token},body:JSON.stringify({name:'schema_describe_collection',args:{collection}})});
        return {status:response.status,body:await response.json()};
      }
      return {admin:await describe(adminEmail),member:await describe(memberEmail)};
    },{adminEmail:f.admin.email,memberEmail:f.member.email,password:f.password,collection:f.names.business});
    for(let pass=0;pass<2;pass++){
      const result=await inspect();
      expect(result.admin.status).toBe(200);expect(result.member.status).toBe(200);
      expect(result.admin.body.data.fields.find(field=>field.field==='state').choices).toEqual(stateChoices);
      expect(result.admin.body.data.fields.find(field=>field.field==='priority').choices).toEqual(priorityChoices);
      expect(result.member.body.data.fields.map(field=>field.field)).toEqual(memberFields);
      expect(result.member.body.data.fields.find(field=>field.field==='state').choices).toEqual(stateChoices);
      expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPOSE');
      if(pass===0)await page.reload();
    }
    f.setPolicy([f.names.config,f.names.business]);
    const denied=await inspect();expect(denied.admin.status).toBe(403);expect(denied.member.status).toBe(403);
    accepted=true;
  }finally{await f.close({preserve:!accepted});}
});
