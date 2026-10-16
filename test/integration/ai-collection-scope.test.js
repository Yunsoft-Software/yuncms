import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiCollectionFixture} from '../helpers/ai-collection-fixture.mjs';

test('native AI collection fences cover cached administrators, discovery, relation reads and allowed business CRUD',{
 skip:process.env.YUNCMS_TEST_MYSQL!=='1',timeout:90000,
},async()=>{
 const f=await createAiCollectionFixture();let accepted=false;
 try{
  const token=await f.login(f.admin),member=await f.login(f.member);
  // Warm the real native administrator permission cache outside the AI scope.
  assert.equal((await f.request('/items/'+f.names.config,{token})).status,200);
  assert.ok(await f.cache.get('admin:'+f.names.config+':read'));
  const discovery=await f.tool(token,'schema_list_collections',{});
  assert.equal(discovery.status,200);assert.ok(discovery.body.data.collections.some(c=>c.collection===f.names.business));
  assert.ok(!discovery.body.data.collections.some(c=>c.collection===f.names.config));
  const description=await f.tool(token,'schema_describe_collection',{collection:f.names.business});
  assert.equal(description.status,200);assert.equal(description.body.data.fields.find(field=>field.field==='config_ref').relation,undefined);
  for(const [name,args] of [
   ['schema_describe_collection',{collection:f.names.config}],
   ['items_read_many',{collection:f.names.config}],
   ['items_read_one',{collection:f.names.config,id:f.privateRow.id}],
   ['items_create',{collection:f.names.config,data:{secret:'Forbidden create'}}],
   ['items_update',{collection:f.names.config,id:f.privateRow.id,data:{secret:'Forbidden update'}}],
   ['items_delete',{collection:f.names.config,id:f.privateRow.id}],
   ['items_read_many',{collection:f.names.business,fields:'id,config_ref.secret'}],
   ['items_read_many',{collection:f.names.business,expand:'config_ref'}],
   ['items_read_one',{collection:f.names.business,id:f.businessRow.id,fields:'id,config_ref.secret'}],
  ]){
   const r=await f.tool(token,name,args,{denied_collections:[],allow_all:true});
   assert.equal(r.status,403,name);assert.equal(r.body.errors[0].code,'FORBIDDEN');assert.equal(r.body.data,undefined);
  }
  // Native queries reject relation-path filtering/sorting even outside AI.
  // They cannot become a count/sort oracle for a fenced collection either.
  for(const query of [{filter:{'config_ref.secret':{_eq:f.privateRow.secret}}},{sort:'config_ref.secret'}]){
   const params=new URLSearchParams(Object.entries(query).map(([key,value])=>[key,typeof value==='object'?JSON.stringify(value):value]));
   const normal=await f.request('/items/'+f.names.business+'?'+params,{token});
   const scoped=await f.tool(token,'items_read_many',{collection:f.names.business,...query});
   for(const result of [normal,scoped]){assert.equal(result.status,400);assert.equal(result.body.errors[0].code,'INVALID_QUERY');assert.equal(result.body.data,undefined);}
  }
  const before=await f.request('/items/'+f.names.config,{token});assert.equal(before.body.data.length,1);assert.equal(before.body.data[0].secret,f.privateRow.secret);
  const concurrent=await Promise.all(Array.from({length:4},async()=>[
   (await f.request('/items/'+f.names.config,{token})).status,
   (await f.tool(token,'items_read_many',{collection:f.names.config})).status,
  ]));assert.deepEqual(concurrent,Array.from({length:4},()=>[200,403]));
  const created=await f.tool(token,'items_create',{collection:f.names.business,data:{title:'Allowed business create'}});assert.equal(created.status,200);
  const id=created.body.data.id;
  assert.equal((await f.tool(token,'items_update',{collection:f.names.business,id,data:{title:'Allowed business update'}})).status,200);
  assert.equal((await f.tool(token,'items_read_one',{collection:f.names.business,id,fields:'id,title'})).body.data.title,'Allowed business update');
  assert.equal((await f.tool(member,'items_read_many',{collection:f.names.business,fields:'id,title'})).status,200);
  assert.equal((await f.tool(member,'items_create',{collection:f.names.business,data:{title:'Unauthorized member write'}})).status,403);
  const [[audit]]=await f.pool.query('SELECT user FROM yuncms_audit_log WHERE collection=? AND item_key=? AND action=? ORDER BY id DESC LIMIT 1',[f.names.business,id,'items.update']);
  assert.equal(audit.user,f.admin.id);
  assert.equal((await f.tool(token,'items_delete',{collection:f.names.business,id})).status,200);
  assert.equal((await f.request('/items/'+f.names.config,{token})).status,200,'The original administrator remains authorized outside AI');
  f.setPolicy(null);
  const invalid=await f.request('/ai/chat',{method:'POST',token,body:{messages:[{role:'user',content:'Do not contact a provider.'}],denied_collections:[]}});
  assert.equal(invalid.status,503);assert.equal(invalid.body.errors[0].code,'AI_COLLECTION_POLICY_INVALID');
  accepted=true;
 }finally{await f.close({preserve:!accepted});}
});
