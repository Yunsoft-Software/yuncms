import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountability,HookEmitter} from '@yunsoft/yuncms-core';
import {resolveAiCollectionRequest} from '../src/ai/collection-policy.js';

test('a real extension hook restricts only the AI request; client fields cannot remove its fence',async()=>{
 const emitter=new HookEmitter(),actor=createAccountability({user:'same-user',role:'admin',admin:true});
 emitter.registerFilter('ai.tools.policy',policy=>({...policy,denied_collections:['project_config']}));
 const req={accountability:actor,context:{},body:{denied_collections:[],admin:true}};
 const scoped=await resolveAiCollectionRequest(req,emitter);
 assert.deepEqual(scoped.accountability.deniedCollections,['project_config']);
 assert.equal(scoped.accountability.user,actor.user);assert.equal(scoped.accountability.admin,true);
 assert.equal(req.accountability,actor);assert.equal(actor.deniedCollections,undefined);
});

test('invalid extension AI policies fail closed before provider or tool execution',async()=>{
 for(const policy of [null,[],{}, {denied_collections:null},{denied_collections:['*']},{denied_collections:[],allow_all:true}]){
  const emitter=new HookEmitter();emitter.registerFilter('ai.tools.policy',()=>policy);
  await assert.rejects(resolveAiCollectionRequest({accountability:createAccountability({user:'u'}),context:{}},emitter),{code:'AI_COLLECTION_POLICY_INVALID'});
 }
});
