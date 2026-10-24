import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {bootstrapDatabase,createDatabasePool,loadConfig,createCoreServiceRegistry,SchemaCache,HookEmitter} from '@yunsoft/yuncms-core';
import {loadExtensionRuntime} from '../../packages/api/src/extensions/runtime.js';
import {createApp} from '../../packages/api/src/app.js';

export async function startExtensionCorsRuntime(){
 if(process.env.YUNCMS_TEST_MYSQL!=='1'||process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE!=='1')throw Error('Real CORS acceptance requires an authorized disposable MySQL database');
 const config=loadConfig({...process.env,STUDIO_ORIGIN:'https://studio.example.test',API_RATE_LIMIT_ENABLED:'false',PRESSURE_LIMIT_ENABLED:'false'});
 if(!/(test|ci|dev)/i.test(config.database.database))throw Error('Disposable database required');
 const pool=createDatabasePool(config.database),root=await mkdtemp(join(tmpdir(),'yuncms-cors-test-'));let runtime,api,apiOrigin;
 const site=()=>createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end(`<!doctype html><html><title>Extension CORS acceptance</title><body><button id="send">Send JSON</button><button id="stream">Open stream</button><output id="result"></output><script>
const output=document.querySelector('#result');document.querySelector('#send').onclick=async()=>{try{const response=await fetch('${apiOrigin}/extensions/cors-opted/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Actual cross-origin JSON'})});output.textContent=JSON.stringify(await response.json());}catch{output.textContent='CORS rejected';}};
document.querySelector('#stream').onclick=()=>{const stream=new EventSource('${apiOrigin}/extensions/cors-opted/events');stream.onmessage=event=>{output.textContent=event.data;stream.close();};stream.onerror=()=>{output.textContent='CORS rejected';stream.close();}};
</script></body></html>`);});
 const allowed=site(),forbidden=site();const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await bootstrapDatabase(pool);await listen(allowed);await listen(forbidden);const allowedOrigin='http://127.0.0.1:'+allowed.address().port,forbiddenOrigin='http://127.0.0.1:'+forbidden.address().port;
  for(const [id,optIn]of[['cors-opted',true],['cors-default',false]]){const dir=join(root,'extensions',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify({name:id,type:'module',yuncms:{type:'endpoint',id,entry:'./index.js',...(optIn?{customCors:true}:{})}}));await writeFile(join(dir,'index.js'),`export default {__yuncms_extension__:true,type:'endpoint',register(router,context){
router.use((req,res,next)=>{if(req.get('origin')!==context.env.CORS_ALLOWED_ORIGIN)return res.status(403).json({error:'ORIGIN_FORBIDDEN'});res.set({'Access-Control-Allow-Origin':req.get('origin'),'Vary':'Origin'});next();});
router.options('/messages',(req,res)=>res.set({'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','X-Extension-Preflight':'reached'}).status(204).end());
router.post('/messages',(req,res)=>res.json({message:req.body.message,public:req.accountability.public,user:req.accountability.user||null}));
router.get('/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.end('data: Actual extension event\\n\\n');});
}};`);}
  const cache=new SchemaCache(),services=createCoreServiceRegistry().toObject(),emitter=new HookEmitter();runtime=await loadExtensionRuntime({rootDir:root,includeDependencies:false,services,database:pool,schemaCache:cache,emitter,env:{...process.env,CORS_ALLOWED_ORIGIN:allowedOrigin},authConfig:config.auth});
  const app=createApp({pool,config,schemaCache:cache,emitter,endpointExtensions:runtime.endpointExtensions});api=app.listen(0,'127.0.0.1');await new Promise(resolve=>api.once('listening',resolve));apiOrigin='http://127.0.0.1:'+api.address().port;
  return {apiOrigin,allowedOrigin,forbiddenOrigin,close:async()=>{await runtime.stopSchedules();for(const s of[allowed,forbidden,api])await new Promise(resolve=>s.close(resolve));await pool.end();await rm(root,{recursive:true,force:true});}};
 }catch(error){for(const s of[allowed,forbidden,api])if(s?.listening)await new Promise(resolve=>s.close(resolve));await runtime?.stopSchedules();await pool.end();await rm(root,{recursive:true,force:true});throw error;}
}
