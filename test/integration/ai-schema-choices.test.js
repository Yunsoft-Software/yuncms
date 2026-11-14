import assert from 'node:assert/strict';
import test from 'node:test';
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
