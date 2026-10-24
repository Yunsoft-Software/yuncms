import {test,expect} from '@playwright/test';import {startExtensionCorsRuntime} from '../helpers/extension-cors-runtime.mjs';
let h;test.beforeAll(async()=>{h=await startExtensionCorsRuntime();});test.afterAll(async()=>{await h?.close();});
test('external website sends real JSON and receives SSE while another website is rejected',async({page})=>{
 await page.goto(h.allowedOrigin);await page.getByRole('button',{name:'Send JSON',exact:true}).click();await expect(page.locator('#result')).toHaveText(JSON.stringify({message:'Actual cross-origin JSON',public:true,user:null}));
 await page.getByRole('button',{name:'Open stream',exact:true}).click();await expect(page.locator('#result')).toHaveText('Actual extension event');
 await page.goto(h.forbiddenOrigin);await page.getByRole('button',{name:'Send JSON',exact:true}).click();await expect(page.locator('#result')).toHaveText('CORS rejected');
});
