import assert from 'node:assert/strict';import test from 'node:test';import{randomBytes,randomUUID}from'node:crypto';import mysql from'mysql2/promise';
import{AuthService,AuthTokensService,ApiTokensService,bootstrapDatabase,closeDatabasePool,createAccountability,createDatabasePool,createPublicAccountability,createSystemAccountability,ExternalAuthService,HookEmitter,loadConfig,SchemaCache,TotpService,UsersService}from'@yunsoft/yuncms-core';
import{createApp}from'../../packages/api/src/app.js';import{registerInternalAudit}from'../../packages/api/src/audit-hooks.js';import{createCoreServiceRegistry}from'@yunsoft/yuncms-core';
import{authenticatorCode,incorrectAuthenticatorCode,nextAuthenticatorPeriod}from'../helpers/totp.js';

test('native TOTP: real HTTP/MySQL enrollment, challenge, replay, recovery, persistence and authorization', {skip:process.env.YUNCMS_TEST_MYSQL!=='1',timeout:180000}, async t=>{
 assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE,'1');const database='yuncms_test_totp_'+randomBytes(5).toString('hex'),key=randomBytes(32).toString('hex'),password='Owned-totp-'+randomUUID()+'!';
 const config=loadConfig({...process.env,DB_DATABASE:database,AUTH_TOTP_KEY:key,AUTH_LOGIN_RATE_MAX:'1000',AUTH_ACTION_RATE_MAX:'1000',AUTH_RATE_LIMIT_STORE:'memory',API_RATE_LIMIT_ENABLED:'false'});
 const root=await mysql.createConnection({host:config.database.host,port:config.database.port,user:config.database.user,password:config.database.password});let pool,server;
 try{
  await root.query('CREATE DATABASE ??',[database]);pool=createDatabasePool(config.database);await bootstrapDatabase(pool);
  const emitter=new HookEmitter({logger:{error(){}}}),options={database:pool,accountability:createSystemAccountability(),emitter,authConfig:config.auth};
  registerInternalAudit({emitter,services:createCoreServiceRegistry().toObject(),database:pool,logger:console});
  const users=new UsersService(options),user=await users.createOne({email:'totp-'+randomUUID()+'@example.test',password}),other=await users.createOne({email:'other-'+randomUUID()+'@example.test',password});
  let base,session,recovery,secret;
  const start=async(c=config)=>{const app=createApp({pool,config:c,schemaCache:new SchemaCache(),emitter});server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});base='http://127.0.0.1:'+server.address().port;};await start();
  const request=async(path,body,token,method=body===undefined?'GET':'POST')=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,headers:r.headers,body:r.status===204?null:await r.json()};};
  const login=async(email=user.email)=>{const r=await request('/auth/login',{email,password});assert.equal(r.status,200);return r.body.data;};
  const state=async()=>{const[[row]]=await pool.query('SELECT * FROM yuncms_user_totp WHERE user=?',[user.id]);return row;};
  session=await login();const oldSession=session;
  await t.test('capability discovery and session-only self-service expose no secrets or foreign account state',async()=>{
   const cap=await request('/auth/capabilities');assert.equal(cap.status,200);assert.equal(cap.body.data.totp.available,true);assert.equal(cap.headers.get('cache-control'),'no-store');
   assert.equal((await request('/auth/tfa')).status,401);assert.equal((await request('/auth/tfa/enroll',{password})).status,401);
   const status=await request('/auth/tfa',undefined,session.access_token);assert.equal(status.body.data.enabled,false);assert.equal(JSON.stringify(status.body).includes(key),false);
   const api=await new ApiTokensService({...options,accountability:createAccountability({user:user.id})}).createOne({name:'TOTP boundary'});
   assert.equal((await request('/auth/tfa',undefined,api.token)).status,401);
  });
  await t.test('wrong password and unconfirmed enrollment cannot activate a factor; starting again invalidates the old seed',async()=>{
   const bad=await request('/auth/tfa/enroll',{password:'incorrect'},session.access_token);assert.equal(bad.status,400);assert.equal(bad.body.errors[0].code,'INVALID_TFA_VERIFICATION');assert.equal((await state()).failed_attempts,1);
   const first=await request('/auth/tfa/enroll',{password,user:other.id},session.access_token);assert.equal(first.status,200);assert.match(first.body.data.secret,/^[A-Z2-7]{32}$/);
   await pool.query('UPDATE yuncms_user_totp SET pending_expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE user=?',[user.id]);const expired=await request('/auth/tfa/confirm',{password,code:authenticatorCode(first.body.data.secret)},session.access_token);assert.equal(expired.status,400);assert.equal((await state()).enabled_at,null);
   const next=await request('/auth/tfa/enroll',{password},session.access_token);secret=next.body.data.secret;assert.notEqual(secret,first.body.data.secret);
   const pending=await state();assert.equal(pending.enabled_at,null);assert.equal(pending.pending_ciphertext.includes(secret),false);
   const[[foreign]]=await pool.query('SELECT COUNT(*) AS n FROM yuncms_user_totp WHERE user=?',[other.id]);assert.equal(Number(foreign.n),0);
   const oldCode=await request('/auth/tfa/confirm',{password,code:incorrectAuthenticatorCode(secret)},session.access_token);assert.equal(oldCode.status,400);
  });
  await t.test('confirmation encrypts the seed, hashes one-time recovery codes, rotates all sessions and writes redacted native audit',async()=>{
   const r=await request('/auth/tfa/confirm',{password,code:authenticatorCode(secret)},session.access_token);assert.equal(r.status,200);session=r.body.data.session;recovery=r.body.data.recovery_codes;assert.equal(recovery.length,8);assert.equal(new Set(recovery).size,8);
   const row=await state();assert.ok(row.enabled_at);assert.equal(row.pending_ciphertext,null);assert.equal(row.secret_ciphertext.includes(secret),false);for(const code of recovery)assert.equal(JSON.stringify(row).includes(code.replaceAll('-','')),false);
   assert.equal((await request('/users/'+user.id,undefined,oldSession.access_token)).status,401);assert.equal((await request('/auth/refresh',{refresh_token:oldSession.refresh_token})).status,401);assert.equal((await request('/users/'+user.id,undefined,session.access_token)).status,200);
   const[audits]=await pool.query("SELECT payload FROM yuncms_audit_log WHERE action='auth.tfa.enabled' AND item_key=?",[user.id]);assert.equal(audits.length,1);assert.equal(JSON.stringify(audits).includes(secret),false);assert.equal(JSON.stringify(audits).includes(password),false);
  });
  await t.test('correct primary credentials issue only a short-lived challenge; bearer and refresh cannot use it',async()=>{
   const r=await login();assert.equal(r.mfa_required,true);assert.equal(r.access_token,undefined);assert.equal(r.refresh_token,undefined);assert.match(r.challenge_token,/^ycm_/);
   assert.equal((await request('/users/'+user.id,undefined,r.challenge_token)).status,401);assert.equal((await request('/auth/refresh',{refresh_token:r.challenge_token})).status,401);
   const[[stored]]=await pool.query('SELECT * FROM yuncms_mfa_challenges WHERE user=?',[user.id]);assert.equal(JSON.stringify(stored).includes(r.challenge_token),false);
  });
  await t.test('used enrollment TOTP is rejected; concurrent recovery-code submissions create exactly one session',async()=>{
   const c=await login(),sameStep=await state();
   if(Math.floor(Date.now()/30000)===Number(sameStep.last_used_step)){const replay=await request('/auth/tfa/verify',{challenge_token:c.challenge_token,code:authenticatorCode(secret)});assert.equal(replay.status,401);}
   const before=await pool.query('SELECT COUNT(*) AS n FROM yuncms_sessions WHERE user=?',[user.id]);
   const replies=await Promise.all([1,2].map(()=>request('/auth/tfa/verify',{challenge_token:c.challenge_token,recovery_code:recovery[0]})));assert.deepEqual(replies.map(r=>r.status).sort(),[200,401]);
   const after=await pool.query('SELECT COUNT(*) AS n FROM yuncms_sessions WHERE user=?',[user.id]);assert.equal(Number(after[0][0].n),Number(before[0][0].n)+1);const hashes=(await state()).recovery_hashes;assert.equal((Array.isArray(hashes)?hashes:JSON.parse(hashes)).length,7);
  });
  await t.test('challenge replacement, expiry and exhausted attempts fail closed without granting a session',async()=>{
   const a=await login(),b=await login();assert.equal((await request('/auth/tfa/verify',{challenge_token:a.challenge_token,recovery_code:recovery[1]})).status,401);
   await pool.query('UPDATE yuncms_mfa_challenges SET expires_at=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE user=?',[user.id]);assert.equal((await request('/auth/tfa/verify',{challenge_token:b.challenge_token,recovery_code:recovery[1]})).status,401);
   const c=await login();for(let i=0;i<5;i++)assert.equal((await request('/auth/tfa/verify',{challenge_token:c.challenge_token,code:'not-a-code'})).status,401);
   assert.equal((await request('/auth/tfa/verify',{challenge_token:c.challenge_token,recovery_code:recovery[1]})).status,401);
  });
  await t.test('wrong-code counters persist across challenges and service restarts; account lock cannot be bypassed by another primary login',async()=>{
   const c=await login();for(let i=0;i<5;i++){const r=await request('/auth/tfa/verify',{challenge_token:c.challenge_token,code:'invalid'});assert.ok([401,429].includes(r.status));}
   assert.ok((await state()).locked_until);assert.equal((await request('/auth/login',{email:user.email,password})).status,429);
   await new Promise(r=>server.close(r));await start();assert.equal((await request('/auth/login',{email:user.email,password})).status,429);
   // A real expired lock fixture exercises database UTC expiry, not a fake clock.
   await pool.query('UPDATE yuncms_user_totp SET locked_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)) WHERE user=?',[user.id]);
  });
  await t.test('a fresh real-clock TOTP finishes login, remains single-use and survives HTTP server restart',async()=>{
   const last=await state();await nextAuthenticatorPeriod(last.last_used_step);const c=await login(),code=authenticatorCode(secret),r=await request('/auth/tfa/verify',{challenge_token:c.challenge_token,code});assert.equal(r.status,200);session=r.body.data;
   const next=await login();assert.equal((await request('/auth/tfa/verify',{challenge_token:next.challenge_token,code})).status,401);
   await new Promise(r=>server.close(r));await start();assert.equal((await request('/users/'+user.id,undefined,session.access_token)).status,200);assert.equal((await request('/auth/tfa',undefined,session.access_token)).body.data.enabled,true);
  });
  await t.test('external primary login and direct native session creation cannot bypass enabled TOTP',async()=>{
   const external=new ExternalAuthService({...options,accountability:createPublicAccountability()});await pool.query('INSERT INTO yuncms_auth_identities (id,provider,subject,user) VALUES (?,?,?,?)',[randomUUID(),'owned-test','owned-subject',user.id]);
   const r=await external.completeLogin({provider:'owned-test',subject:'owned-subject'});assert.equal(r.mfa_required,true);assert.equal(r.access_token,undefined);
   const {SessionsService}=await import('../../packages/core/src/services/sessions-service.js');await assert.rejects(new SessionsService(options).createForUser(user),{code:'MFA_REQUIRED'});
  });
  await t.test('password changes, reset, suspension and logout-all invalidate challenges without removing the factor',async()=>{
   const verify=async(code)=>{const c=await login(),r=await request('/auth/tfa/verify',{challenge_token:c.challenge_token,recovery_code:code});assert.equal(r.status,200);session=r.body.data;};
   const pending=await login();await users.updatePassword(user.id,password);assert.equal((await request('/auth/tfa/verify',{challenge_token:pending.challenge_token,recovery_code:recovery[3]})).status,401);await verify(recovery[3]);
   const suspended=await login();await users.updateOne(user.id,{status:'suspended'});assert.equal((await request('/auth/tfa/verify',{challenge_token:suspended.challenge_token,recovery_code:recovery[4]})).status,401);await users.updateOne(user.id,{status:'active'});assert.equal((await request('/auth/tfa/verify',{challenge_token:suspended.challenge_token,recovery_code:recovery[4]})).status,401);await verify(recovery[4]);
   const resetPending=await login(),actions=new AuthTokensService(options),reset=await actions.requestPasswordReset(user.email);await actions.resetPassword(reset.token,password);assert.equal((await request('/auth/tfa/verify',{challenge_token:resetPending.challenge_token,recovery_code:recovery[5]})).status,401);await verify(recovery[5]);
   const all=await login();assert.equal((await request('/auth/logout-all',{},session.access_token)).status,204);assert.equal((await request('/auth/tfa/verify',{challenge_token:all.challenge_token,recovery_code:recovery[6]})).status,401);await verify(recovery[6]);assert.ok((await state()).enabled_at);
  });
  await t.test('omitted or wrong encryption key advertises unavailable or fails closed while enabled state persists',async()=>{
   await new Promise(r=>server.close(r));await start({...config,auth:{...config.auth,totpKey:null}});assert.equal((await request('/auth/capabilities')).body.data.totp.available,false);assert.equal((await request('/auth/login',{email:user.email,password})).status,503);
   await new Promise(r=>server.close(r));await start({...config,auth:{...config.auth,totpKey:randomBytes(32).toString('hex')}});const c=await login();assert.equal((await request('/auth/tfa/verify',{challenge_token:c.challenge_token,code:authenticatorCode(secret)})).status,503);
   await new Promise(r=>server.close(r));await start();
  });
  await t.test('recovery regeneration revokes prior sessions, old codes and pending challenges; disabling needs password plus current factor',async()=>{
   const pending=await login(),old=session,r=await request('/auth/tfa/recovery-codes',{password,recovery_code:recovery[1]},session.access_token);assert.equal(r.status,200);session=r.body.data.session;const fresh=r.body.data.recovery_codes;
   assert.equal((await request('/users/'+user.id,undefined,old.access_token)).status,401);assert.equal((await request('/auth/tfa/verify',{challenge_token:pending.challenge_token,recovery_code:recovery[2]})).status,401);
   const c=await login();assert.equal((await request('/auth/tfa/verify',{challenge_token:c.challenge_token,recovery_code:recovery[2]})).status,401);
   assert.equal((await request('/auth/tfa/disable',{password},session.access_token)).status,400);assert.equal((await request('/auth/tfa/disable',{password:'wrong',recovery_code:fresh[0]},session.access_token)).status,400);
   const disabled=await request('/auth/tfa/disable',{password,recovery_code:fresh[0]},session.access_token);assert.equal(disabled.status,200);assert.equal(disabled.body.data.enabled,false);session=disabled.body.data.session;const row=await state();assert.equal(row.secret_ciphertext,null);assert.equal(row.recovery_hashes,null);assert.equal(row.enabled_at,null);
   const ordinary=await login();assert.ok(ordinary.access_token);assert.equal(ordinary.mfa_required,undefined);
  });
 }finally{if(server)await new Promise(r=>server.close(r));if(pool)await closeDatabasePool(pool);assert.match(database,/^yuncms_test_totp_[a-f0-9]{10}$/);await root.query('DROP DATABASE IF EXISTS ??',[database]);await root.end();}
});

test('0027 upgrades a pre-TOTP database without revoking existing users, passwords or sessions', {skip:process.env.YUNCMS_TEST_MYSQL!=='1',timeout:60000},async()=>{
 const {applyMigrations,CORE_MIGRATIONS}=await import('@yunsoft/yuncms-core'),{createOpaqueToken}=await import('../../packages/core/src/auth/tokens.js');
 assert.equal(process.env.YUNCMS_TEST_DB_ALLOW_DESTRUCTIVE,'1');const database='yuncms_test_totp_upgrade_'+randomBytes(5).toString('hex'),config=loadConfig({...process.env,DB_DATABASE:database});
 const root=await mysql.createConnection({host:config.database.host,port:config.database.port,user:config.database.user,password:config.database.password});let pool;
 try{await root.query('CREATE DATABASE ??',[database]);pool=createDatabasePool(config.database);await applyMigrations(pool,CORE_MIGRATIONS.slice(0,CORE_MIGRATIONS.findIndex(m=>m.id==='0027-native-totp')));
 const user=await new UsersService({database:pool,accountability:createSystemAccountability()}).createOne({email:'legacy-totp@example.test',password:'Legacy-TOTP-password-123!'}),access=createOpaqueToken('access'),refresh=createOpaqueToken('refresh');
 await pool.query('INSERT INTO yuncms_sessions (id,user,token_hash,access_token_hash,access_expires_at,expires_at) VALUES (?,?,?,?,TIMESTAMPADD(MINUTE,10,UTC_TIMESTAMP(3)),TIMESTAMPADD(DAY,1,UTC_TIMESTAMP(3)))',[randomUUID(),user.id,refresh.hash,access.hash]);
 const[[before]]=await pool.query('SELECT password_hash,role,status FROM yuncms_users WHERE id=?',[user.id]);const result=await bootstrapDatabase(pool);assert.deepEqual(result.newlyApplied,['0027-native-totp']);
 const[[after]]=await pool.query('SELECT password_hash,role,status FROM yuncms_users WHERE id=?',[user.id]);assert.deepEqual(after,before);const auth=new AuthService({database:pool,accountability:createPublicAccountability()});assert.equal((await auth.authenticateAccessToken(access.token)).user,user.id);const normal=await auth.login({email:user.email,password:'Legacy-TOTP-password-123!'});assert.ok(normal.access_token);assert.equal(normal.mfa_required,undefined);
 assert.deepEqual((await bootstrapDatabase(pool)).newlyApplied,[]);
 }finally{if(pool)await closeDatabasePool(pool);await root.query('DROP DATABASE IF EXISTS ??',[database]);await root.end();}
});
