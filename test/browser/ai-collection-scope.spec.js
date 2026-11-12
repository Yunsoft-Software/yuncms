import {test,expect} from '@playwright/test';
import {createAiCollectionFixture} from '../helpers/ai-collection-fixture.mjs';

test('real browser preserves native admin identity while the server fences AI configuration tools',async({page})=>{
 const f=await createAiCollectionFixture();let accepted=false;
 try{
  await page.goto(f.origin+'/health');
  const result=await page.evaluate(async({origin,email,password,collection,id,businessCollection,businessId})=>{
   const post=async(path,body,token)=>{const r=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:r.status===204?null:await r.json()};};
   const login=await post('/auth/login',{email,password});if(login.status!==200)throw Error('Native login failed');
   const token=login.body.data.access_token;
   const normal=await fetch('/items/'+collection,{headers:{authorization:'Bearer '+token}});
   const denied=await post('/extensions/ai-scope-probe/tool',{name:'items_update',args:{collection,id,data:{secret:'Browser must not change this'}},denied_collections:[]},token);
   const after=await fetch('/items/'+collection,{headers:{authorization:'Bearer '+token}});
   const rows=(await after.json()).data;
   const missingId=businessId.split('-')[0];
   const missingUpdate=await post('/extensions/ai-scope-probe/tool',{name:'items_update',args:{collection:businessCollection,id:missingId,data:{title:'Must not update'}}},token);
   const missingDelete=await post('/extensions/ai-scope-probe/tool',{name:'items_delete',args:{collection:businessCollection,id:missingId}},token);
   const business=await fetch('/items/'+businessCollection+'/'+businessId,{headers:{authorization:'Bearer '+token}});
   const businessUnchanged=(await business.json()).data.title==='Business before';
   const logout=await post('/auth/logout',{},token);
   return {normal:normal.status,denied:denied.status,code:denied.body.errors?.[0]?.code,unchanged:rows[0].secret.startsWith('ONLY_CONFIG_'),logout:logout.status,missingUpdate:missingUpdate.status,missingDelete:missingDelete.status,missingCodes:[missingUpdate.body.errors?.[0]?.code,missingDelete.body.errors?.[0]?.code],businessUnchanged};
  },{origin:f.origin,email:f.admin.email,password:f.password,collection:f.names.config,id:f.privateRow.id,businessCollection:f.names.business,businessId:f.businessRow.id});
  expect(result).toEqual({normal:200,denied:403,code:'FORBIDDEN',unchanged:true,logout:204,missingUpdate:404,missingDelete:404,missingCodes:['NOT_FOUND','NOT_FOUND'],businessUnchanged:true});accepted=true;
 }finally{await test.step('Close native HTTP fixture and dispose owned synthetic data',()=>f.close({preserve:!accepted}));}
});
