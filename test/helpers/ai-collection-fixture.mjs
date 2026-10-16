import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import {bootstrapDatabase,createCoreServiceRegistry,createDatabasePool,closeDatabasePool,createSystemAccountability,HookEmitter,loadConfig,SchemaCache,createStorageRegistry,LocalStorageDriver} from '@yunsoft/yuncms-core';
import {MemoryCacheStore} from '../../packages/core/src/cache.js';
import {createApp} from '../../packages/api/src/app.js';
import {registerInternalAudit} from '../../packages/api/src/audit-hooks.js';
import {resolveAiCollectionRequest} from '../../packages/api/src/ai/collection-policy.js';
import {executeAiTool} from '../../packages/api/src/ai/tools.js';
import {AiSettingsStore} from '../../packages/api/src/ai/settings-store.js';
import {AiAssistantService} from '../../packages/api/src/ai/service.js';
import {createAiRouter} from '../../packages/api/src/routes/ai.js';

// Real native SQL/auth/permissions/hooks/executor over HTTP. No provider is
// substituted: the probe invokes the actual native tool executor directly.
export async function createAiCollectionFixture(){
 assert.equal(process.env.YUNCMS_TEST_MYSQL,'1');assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE,'1');
 const config=loadConfig(process.env);assert.match(config.database.database,/(test|ci|dev)/i);
 const pool=createDatabasePool(config.database),system=createSystemAccountability(),options={database:pool,accountability:system};
 await bootstrapDatabase(pool);
 const services=createCoreServiceRegistry().toObject(),schemaCache=new SchemaCache({versionCheckTtlMs:0}),cache=new MemoryCacheStore();
 const nonce=randomBytes(5).toString('hex'),names={business:'fence_business_'+nonce,config:'fence_config_'+nonce};
 const collections=new services.CollectionsService(options),fields=new services.FieldsService(options),roles=new services.RolesService(options),users=new services.UsersService(options);
 await collections.createOne({collection:names.config,hidden:true});await fields.createOne(names.config,{field:'secret',type:'string'});
 await collections.createOne({collection:names.business});
 await fields.createOne(names.business,{field:'title',type:'string'});await fields.createOne(names.business,{field:'config_ref',type:'uuid'});
 await new services.RelationsService(options).createM2O({manyCollection:names.business,manyField:'config_ref',oneCollection:names.config,onDelete:'SET NULL'});
 const privateRow=await new services.ItemsService(names.config,options).createOne({secret:'ONLY_CONFIG_'+nonce});
 const businessRow=await new services.ItemsService(names.business,options).createOne({title:'Business before',config_ref:privateRow.id});
 const adminRole=await roles.createOne({name:'Fence administrator '+nonce,admin:true});
 const memberRole=await roles.createOne({name:'Fence reader '+nonce,admin:false});
 const password='NativeFence-'+nonce+'-Password!';
 const admin=await users.createOne({email:'fence-admin-'+nonce+'@example.test',password,role:adminRole.id});
 const member=await users.createOne({email:'fence-reader-'+nonce+'@example.test',password,role:memberRole.id});
 await new services.PermissionsService(options).createOne({role:memberRole.id,collection:names.business,action:'read',fields:['id','title'],filter:null});
 let policy=[names.config];
 const emitter=new HookEmitter();emitter.registerFilter('ai.tools.policy',payload=>({...payload,denied_collections:policy}));
 registerInternalAudit({emitter,services,database:pool,logger:console});
 const router=express.Router();
 router.post('/tool',async(req,res,next)=>{
  try{
   if(!req.accountability?.user)throw Object.assign(new Error('Authentication required'),{code:'UNAUTHORIZED'});
   const scoped=await resolveAiCollectionRequest(req,emitter);
   const data=await executeAiTool(scoped,req.body.name,req.body.args,{writesEnabled:true,deletesEnabled:true});
   res.json({data});
  }catch(error){next(error);}
 });
 const files=await mkdtemp(join(tmpdir(),'yuncms-ai-fence-'));
 const storage=createStorageRegistry({local:new LocalStorageDriver({root:files})});
 const settingsStore=new AiSettingsStore({database:pool,key:randomBytes(32)});
 const assistant=new AiAssistantService({settingsStore,emitter});
 const aiRouter=createAiRouter({assistant,settingsStore});
 const app=createApp({pool,config,schemaCache,permissionCache:cache,emitter,storage,aiRouter,endpointExtensions:[{id:'ai-scope-probe',router}]});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const origin='http://127.0.0.1:'+server.address().port;
 async function request(path,{method='GET',body,token}={}){
  const r=await fetch(origin+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:r.status===204?null:await r.json()};
 }
 async function login(user){const r=await request('/auth/login',{method:'POST',body:{email:user.email,password}});assert.equal(r.status,200);return r.body.data.access_token;}
 async function tool(token,name,args,extra={}){return request('/extensions/ai-scope-probe/tool',{method:'POST',token,body:{name,args,...extra}});}
 async function close({preserve=false}={}){
  await new Promise(resolve=>server.close(resolve));
  try{if(!preserve){
   await new services.RelationsService(options).deleteM2O(names.business,'config_ref');
   await collections.deleteOne(names.business,{destructive:true});await collections.deleteOne(names.config,{destructive:true});
   // Cleanup is limited to these disposable identities, including the last
   // administrator role which normal runtime APIs intentionally protect.
   await pool.query('DELETE FROM yuncms_users WHERE id IN (?,?)',[admin.id,member.id]);
   await pool.query('DELETE FROM yuncms_permissions WHERE role IN (?,?)',[adminRole.id,memberRole.id]);
   await pool.query('DELETE FROM yuncms_roles WHERE id IN (?,?)',[adminRole.id,memberRole.id]);
  }}finally{await closeDatabasePool(pool);await rm(files,{recursive:true,force:true});}
 }
 return {pool,origin,request,login,tool,close,names,privateRow,businessRow,admin,member,password,cache,setPolicy:value=>{policy=value;}};
}
