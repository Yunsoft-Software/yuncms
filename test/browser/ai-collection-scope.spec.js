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

test('Studio AI workspace displays verified mutation receipts across multi-turn create, update and delete with real provider', async ({ page, request }) => {
  test.setTimeout(180000);
  const login = await request.post('/auth/login', { data: { email: 'flows-admin@example.test', password: 'Browser-flow-fixture-123!' } });
  expect(login.status()).toBe(200);
  const session = (await login.json()).data;
  const headers = { authorization: `Bearer ${session.access_token}` };
  const collection = `ai_ui_${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
  let createdCollection = false;
  expect((await request.post('/extensions/flow-fixture/ai/allow', { headers })).status()).toBe(204);
  try {
    expect((await request.post('/schema/collections', { headers, data: { collection, primaryKeyType: 'uuid' } })).status()).toBe(201);
    createdCollection = true;
    expect((await request.post(`/schema/collections/${collection}/fields`, { headers, data: { field: 'title', type: 'string', required: true } })).status()).toBe(201);
    const siblingRes = await request.post(`/items/${collection}`, { headers, data: { title: 'Sibling record to preserve' } });
    expect(siblingRes.status()).toBe(201);
    const sibling = (await siblingRes.json()).data;

    await page.addInitScript(value => {
      sessionStorage.setItem('yuncms.studio.session', JSON.stringify(value));
      localStorage.setItem('yuncms.studio.locale', 'en');
    }, session);
    await page.goto('/#/ai');
    await expect(page.locator('.ai-composer textarea')).toBeEnabled();

    const sendTurn = async (prompt, modeValue) => {
      if (modeValue) {
        await page.locator(`input[name="ai-access-mode"][value="${modeValue}"]`).check();
      }
      await page.locator('.ai-composer textarea').fill(prompt);
      const chatRes = page.waitForResponse(res => new URL(res.url()).pathname === '/ai/chat' && res.request().method() === 'POST', { timeout: 90000 });
      await page.locator('.ai-send-button').click();
      const completed = await chatRes;
      expect(completed.status()).toBe(200);
      return (await completed.json()).data;
    };

    const t1 = await sendTurn(`Create one record in collection ${collection} with title "Browser AI draft".`, 'read');
    expect(t1.mutations).toEqual([]);
    await expect(page.locator('.ai-message.assistant')).toHaveCount(1);

    const t2 = await sendTurn(`Create one record in collection ${collection} with title "Browser AI draft" and report its exact id.`, 'write');
    expect(t2.mutations).toHaveLength(1);
    const targetId = t2.mutations[0].id;
    expect(targetId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page.locator('.ai-message.assistant').nth(1).locator('.ai-mutation.verified')).toContainText(`Created ${collection} #${targetId}`);

    const t3 = await sendTurn(`Update record ${targetId} in collection ${collection} so title is "Browser AI updated". Keep sibling record ${sibling.id} unchanged.`, 'write');
    expect(t3.mutations).toEqual([{ operation: 'items_update', collection, id: targetId }]);
    await expect(page.locator('.ai-message.assistant').nth(2).locator('.ai-mutation.verified')).toContainText(`Updated ${collection} #${targetId}`);

    const t4 = await sendTurn(`Delete only record ${targetId} from collection ${collection} once, and preserve sibling record ${sibling.id}.`, 'full');
    expect(t4.mutations).toEqual([{ operation: 'items_delete', collection, id: targetId }]);
    await expect(page.locator('.ai-message.assistant').nth(3).locator('.ai-mutation.verified')).toContainText(`Deleted ${collection} #${targetId}`);

    expect((await request.get(`/items/${collection}/${targetId}`, { headers })).status()).toBe(404);
    const siblingAfter = await request.get(`/items/${collection}/${sibling.id}`, { headers });
    expect(siblingAfter.status()).toBe(200);
    expect((await siblingAfter.json()).data.title).toBe('Sibling record to preserve');
  } finally {
    await request.post('/extensions/flow-fixture/ai/deny', { headers });
    if (createdCollection) await request.delete(`/schema/collections/${collection}?destructive=true`, { headers });
  }
});
