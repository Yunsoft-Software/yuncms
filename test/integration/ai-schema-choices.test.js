import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createAiCollectionFixture} from '../helpers/ai-collection-fixture.mjs';
import {businessFields,memberFields,stateChoices,priorityChoices} from '../helpers/ai-field-choices.mjs';

test('native AI schema returns declared choices with exact values and current field/collection permissions',{
  skip:process.env.YUNCMS_TEST_MYSQL!=='1',
},async()=>{
  const f=await createAiCollectionFixture({businessFields,memberFields});let accepted=false;
  try{
    const admin=await f.login(f.admin),member=await f.login(f.member);
    const describe=token=>f.tool(token,'schema_describe_collection',{collection:f.names.business});
    const full=await describe(admin);assert.equal(full.status,200);
    assert.deepEqual(full.body.data.fields.find(field=>field.field==='state').choices,stateChoices);
    assert.deepEqual(full.body.data.fields.find(field=>field.field==='priority').choices,priorityChoices);
    assert.equal(JSON.stringify(full.body).includes('DO_NOT_EXPOSE'),false);
    assert.equal(Object.hasOwn(full.body.data.fields.find(field=>field.field==='title'),'choices'),false);
    const restricted=await describe(member);assert.equal(restricted.status,200);
    assert.deepEqual(restricted.body.data.fields.map(field=>field.field),memberFields);
    assert.deepEqual(restricted.body.data.fields.find(field=>field.field==='state').choices,stateChoices);
    assert.equal(JSON.stringify(restricted.body).includes('High'),false);
    const changed=await f.request('/items/'+f.names.business+'/'+f.businessRow.id,{method:'PATCH',token:admin,body:{state:'Tamamlandı'}});
    assert.equal(changed.status,200);
    const [rows]=await f.pool.query('SELECT state FROM `'+f.names.business+'` WHERE id=?',[f.businessRow.id]);
    assert.equal(rows[0].state,'Tamamlandı');
    f.setPolicy([f.names.config,f.names.business]);
    const denied=await describe(admin);assert.equal(denied.status,403);assert.equal(denied.body.errors[0].code,'FORBIDDEN');
    accepted=true;
  }finally{await f.close({preserve:!accepted});}
});

test('real provider uses an English choice label to update its exact native stored value',{
  skip:process.env.YUNCMS_TEST_MYSQL!=='1',timeout:180000,
},async()=>{
  assert.ok(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE,'An actual provider is required');
  const provider=JSON.parse(await readFile(process.env.YUNCMS_TEST_REAL_PROVIDER_FILE,'utf8'));
  const f=await createAiCollectionFixture({businessFields:[{field:'state',type:'string',interface:'select-dropdown',
    options:{choices:[{value:'Yeni',text:'New'},{value:'Tamamlandı',text:'Completed'}]}}]});let accepted=false;
  try{
    const token=await f.login(f.admin),path='/items/'+f.names.business;
    assert.equal((await f.request(path+'/'+f.businessRow.id,{method:'PATCH',token,body:{state:'Yeni'}})).status,200);
    const sibling=await f.request(path,{method:'POST',token,body:{title:'Sibling to preserve',state:'Yeni'}});assert.equal(sibling.status,201);
    const saved=await f.request('/ai/settings',{method:'PATCH',token,body:{enabled:true,writes_enabled:true,
      base_url:provider.OPENROUTER_BASE_URL||provider.AI_BASE_URL,model:provider.AI_CHAT_MODEL,
      api_key:provider.OPENROUTER_API_KEY||provider.OPENROUTER_KEY||provider.AI_API_KEY,
      provider:provider.AI_PROVIDER_ROUTING??null,timeout_ms:45000}});assert.equal(saved.status,200);
    const result=await f.request('/ai/chat',{method:'POST',token,body:{locale:'en',allow_writes:true,allow_deletes:false,
      messages:[{role:'user',content:`Inspect the schema of ${f.names.business}, then mark the record titled "Business before" as completed. Use the configured stored choice value. Keep "Sibling to preserve" unchanged.`}]}});
    assert.equal(result.status,200);assert.deepEqual(result.body.data.mutations,[{operation:'items_update',collection:f.names.business,id:f.businessRow.id}]);
    const [rows]=await f.pool.query('SELECT id,title,state FROM `'+f.names.business+'` ORDER BY id');
    assert.equal(rows.length,2);assert.equal(rows.find(row=>row.id===f.businessRow.id).state,'Tamamlandı');
    assert.equal(rows.find(row=>row.id===sibling.body.data.id).state,'Yeni');
    assert.equal((await f.request(path+'/'+f.businessRow.id,{token})).body.data.state,'Tamamlandı');
    accepted=true;
  }finally{await f.close({preserve:!accepted});}
});
