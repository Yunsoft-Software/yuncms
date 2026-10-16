import {test,expect} from '@playwright/test';

test('browser confirmation payloads cannot change an exhausted native action bucket',async({page})=>{
  await page.goto('/health');
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
  expect(result.statuses).toEqual([...Array(result.limit).fill(400),429]);
  for(const denied of result.denied){expect(denied.status).toBe(429);expect(denied.body.errors[0].code).toBe('RATE_LIMITED');expect(denied.retry).toBeGreaterThan(0);}
});
