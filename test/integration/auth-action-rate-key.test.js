import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import test from 'node:test';
import mysql from 'mysql2/promise';
import {AuthTokensService,bootstrapDatabase,closeDatabasePool,createDatabasePool,createSystemAccountability,loadConfig,SchemaCache,UsersService} from '@yunsoft/yuncms-core';
import {createApp} from '../../packages/api/src/app.js';

test('real native confirmation limits cannot be reset by unrelated email/user payloads or consume blocked tokens', {
  skip:process.env.YUNCMS_TEST_MYSQL!=='1',timeout:90_000,
},async t=>{
  assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE,'1');
  const name='yuncms_test_auth_rate_'+randomBytes(6).toString('hex');
  const config=loadConfig({...process.env,DB_DATABASE:name,AUTH_ACTION_RATE_MAX:'2',AUTH_ACTION_RATE_WINDOW_MS:'60000',AUTH_RATE_LIMIT_STORE:'memory',API_RATE_LIMIT_ENABLED:'false'});
  const root=await mysql.createConnection({host:config.database.host,port:config.database.port,user:config.database.user,password:config.database.password});
  let pool,created=false;
  try{
    await root.query('CREATE DATABASE ??',[name]);created=true;
    pool=createDatabasePool(config.database);await bootstrapDatabase(pool);
    const options={database:pool,accountability:createSystemAccountability()};
    const user=await new UsersService(options).createOne({email:'rate-'+randomBytes(6).toString('hex')+'@example.test',password:'OwnedOriginalPassword123!'});
    const tokens=new AuthTokensService(options);
    for(const path of ['/auth/email-verification/confirm','/auth/password-reset/confirm'])await t.test(path,async()=>{
      const issued=path.includes('password-reset')?await tokens.requestPasswordReset(user.email):await tokens.createEmailVerification(user.id);
      const hash=createHash('sha256').update(issued.token).digest('hex');
      const [[before]]=await pool.query('SELECT token_hash,used_at,expires_at FROM yuncms_auth_tokens WHERE user=? AND token_hash=?',[user.id,hash]);
      const [[identity]]=await pool.query('SELECT password_hash,role,email_verified_at FROM yuncms_users WHERE id=?',[user.id]);
      assert.equal(before.used_at,null);
      const app=createApp({pool,config,schemaCache:new SchemaCache()});
      const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
      async function post(body){
        const response=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        return {status:response.status,body:await response.json(),headers:response.headers};
      }
      try{
        const body={token:'invalid-owned-confirmation-token',password:'OwnedReplacementPassword123!'};
        for(const status of [400,400,429])assert.equal((await post(body)).status,status);
        for(const change of [{email:'unrelated@example.test'},{user:'unrelated-user'},{email:'another@example.test',user:'another-user'}]){
          const denied=await post({...body,...change});assert.equal(denied.status,429);
          assert.equal(denied.body.errors[0].code,'RATE_LIMITED');assert.ok(Number(denied.headers.get('retry-after'))>0);
        }
        assert.equal((await post({...body,token:issued.token,email:'cannot-change-bucket@example.test'})).status,429);
        const [[after]]=await pool.query('SELECT token_hash,used_at,expires_at FROM yuncms_auth_tokens WHERE user=? AND token_hash=?',[user.id,hash]);assert.deepEqual(after,before);
        const [[saved]]=await pool.query('SELECT password_hash,role,email_verified_at FROM yuncms_users WHERE id=?',[user.id]);assert.deepEqual(saved,identity);
      }finally{await new Promise(resolve=>server.close(resolve));}
    });
  }finally{
    if(pool)await closeDatabasePool(pool);
    if(created){assert.match(name,/^yuncms_test_auth_rate_[a-f0-9]{12}$/);await root.query('DROP DATABASE ??',[name]);}
    await root.end();
  }
});
