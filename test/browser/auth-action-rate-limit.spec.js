import {test,expect} from '@playwright/test';
import {createDatabasePool,loadConfig} from '@yunsoft/yuncms-core';
import {createApp} from '../../packages/api/src/app.js';

// Give exhaustion its own real native limiter so multi-step browser workflows
// cannot consume this test's budget, or inherit its deliberately exhausted IP.
let pool,server,origin;
test.beforeAll(async()=>{
  if(process.env.YUNCMS_TEST_MYSQL!=='1'||process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE!=='1')throw Error('Explicit disposable MySQL authorization required');
  const config=loadConfig({...process.env,API_RATE_LIMIT_ENABLED:'0',AUTH_ACTION_RATE_MAX:'5',PRESSURE_LIMIT_ENABLED:'0'});
  if(!/(test|ci|dev)/i.test(config.database.database))throw Error('Disposable database required');
  pool=createDatabasePool({...config.database,connectionLimit:2});
  const app=createApp({pool,config});
  server=await new Promise((resolve,reject)=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));instance.once('error',reject);});
  origin=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool?.end();
});

test('browser confirmation payloads cannot change an exhausted native action bucket',async({page})=>{
  await page.goto(origin+'/health');
  const result=await page.evaluate(async()=>{
    async function post(path,change={}){
      const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'invalid-browser-confirmation-token',password:'UnusedBrowserPassword123!',...change})});
      return {status:response.status,limit:Number(response.headers.get('x-ratelimit-limit')),retry:Number(response.headers.get('retry-after')),body:await response.json()};
    }
    const path='/auth/email-verification/confirm',first=await post(path),statuses=[first.status];
    if(!Number.isSafeInteger(first.limit)||first.limit<1||first.limit>100)throw Error('Explicit bounded native auth fixture required');
    for(let i=1;i<=first.limit;i++)statuses.push((await post(path)).status);
    const denied=[];
    for(const route of [path,'/auth/password-reset/confirm'])for(const change of [{email:'unrelated@example.test'},{user:'unrelated-user'}])denied.push(await post(route,change));
    return {limit:first.limit,statuses,denied};
  });
  expect(result.limit).toBe(5);
  expect(result.statuses).toEqual([...Array(result.limit).fill(400),429]);
  for(const denied of result.denied){expect(denied.status).toBe(429);expect(denied.body.errors[0].code).toBe('RATE_LIMITED');expect(denied.retry).toBeGreaterThan(0);}
});
