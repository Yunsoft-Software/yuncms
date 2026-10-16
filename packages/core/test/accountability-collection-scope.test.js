import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountability,restrictAccountabilityCollections} from '../src/accountability.js';

test('an explicit server collection fence survives native accountability normalization',()=>{
 const actor=createAccountability({user:'user-a',role:'admin-role',admin:true,deniedCollections:['project_config','project_config']});
 assert.deepEqual(actor.deniedCollections,['project_config']);assert.ok(Object.isFrozen(actor.deniedCollections));
 assert.equal(actor.user,'user-a');assert.equal(actor.role,'admin-role');assert.equal(actor.admin,true);
});
test('request scopes accumulate without changing the original identity or its trusted context',()=>{
 const base=createAccountability({user:'same-user',role:'same-role',admin:true});
 const scoped=restrictAccountabilityCollections({...base,capabilities:['items.read']},['private_config']);
 const narrowed=restrictAccountabilityCollections(scoped,['private_config','another_config']);
 assert.deepEqual(narrowed.deniedCollections,['private_config','another_config']);
 assert.equal(base.deniedCollections,undefined);assert.deepEqual(scoped.deniedCollections,['private_config']);
 assert.equal(narrowed.user,base.user);assert.equal(narrowed.role,base.role);assert.equal(narrowed.admin,true);
 assert.deepEqual(narrowed.capabilities,['items.read']);assert.ok(Object.isFrozen(narrowed));
});
test('invalid server collection fences fail closed instead of becoming unrestricted actors',()=>{
 for(const deniedCollections of [null,'project_config',[null],[''],['*'],['config.name'],['a'.repeat(65)]]) {
  assert.throws(()=>createAccountability({admin:true,deniedCollections}),{code:'INVALID_ACCOUNTABILITY_SCOPE'});
 }
});
