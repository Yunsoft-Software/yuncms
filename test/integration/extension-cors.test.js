import test from 'node:test';import assert from 'node:assert/strict';
import {startExtensionCorsRuntime} from '../helpers/extension-cors-runtime.mjs';
test('opted endpoint owns preflight without widening native or unconfigured extension CORS',{skip:process.env.YUNCMS_TEST_MYSQL!=='1'},async t=>{
 const h=await startExtensionCorsRuntime();t.after(()=>h.close());
 const preflight=(path,origin=h.allowedOrigin)=>fetch(h.apiOrigin+path,{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});
 const response=await preflight('/extensions/cors-opted/messages');assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),h.allowedOrigin);assert.equal(response.headers.get('x-extension-preflight'),'reached');
 const sent=await fetch(h.apiOrigin+'/extensions/cors-opted/messages',{method:'POST',headers:{origin:h.allowedOrigin,'content-type':'application/json'},body:JSON.stringify({message:'Real JSON endpoint'})});assert.equal(sent.status,200);assert.deepEqual(await sent.json(),{message:'Real JSON endpoint',public:true,user:null});
 const denied=await preflight('/extensions/cors-opted/messages',h.forbiddenOrigin);assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 for(const path of['/extensions/cors-default/messages','/extensions/cors-opted-neighbor/messages','/items/yuncms_users','/auth/login']){const r=await preflight(path);assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(r.headers.get('x-extension-preflight'),null);}
 const studio=await preflight('/items/yuncms_users','https://studio.example.test');assert.equal(studio.status,204);assert.equal(studio.headers.get('access-control-allow-origin'),'https://studio.example.test');assert.match(studio.headers.get('access-control-allow-methods'),/PUT/);
 const missing=await preflight('/extensions/cors-opted/unknown');assert.equal(missing.status,404);assert.equal(missing.headers.get('x-extension-preflight'),null);
});
