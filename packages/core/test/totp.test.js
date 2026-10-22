import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, matchTotpStep, normalizeRecoveryCode, totpAtStep, totpKey, TOTP_POLICY, totpUri } from '../src/auth/totp.js';
import { loadConfig, CORE_MIGRATIONS } from '../src/index.js';

const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
test('RFC6238 SHA1 vectors including counters after 2038 match independently published values', () => {
  for (const [time, expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']]) {
    assert.equal(totpAtStep(secret, Math.floor(time / 30), 8), expected);
  }
});
test('TOTP verifies exactly six digits with bounded skew and a monotonic replay counter', () => {
  const now = 1_234_567_890_000, current = Math.floor(now / 30_000);
  for (const step of [current-1,current,current+1]) assert.equal(matchTotpStep(secret, totpAtStep(secret,step),now,-1),step);
  assert.equal(matchTotpStep(secret,totpAtStep(secret,current-2),now),null);
  assert.equal(matchTotpStep(secret,totpAtStep(secret,current),now,current),null);
  assert.equal(matchTotpStep(secret,totpAtStep(secret,current-1),now,current),null);
  for (const code of [123456,'12345','1234567',' 123456','12345x',null,{}]) assert.equal(matchTotpStep(secret,code,now),null);
});
test('secrets are unique 160-bit Base32 values and enrollment URIs identify standard parameters', () => {
  const secrets = Array.from({length:100}, generateTotpSecret); assert.equal(new Set(secrets).size,100);
  for (const value of secrets) assert.match(value,/^[A-Z2-7]{32}$/);
  const uri = new URL(totpUri(secrets[0],'üser+test@example.test'));
  assert.equal(uri.protocol,'otpauth:'); assert.equal(uri.hostname,'totp'); assert.ok(decodeURIComponent(uri.pathname).includes('üser+test@example.test'));
  assert.equal(uri.searchParams.get('secret'),secrets[0]); assert.equal(uri.searchParams.get('digits'),'6'); assert.equal(uri.searchParams.get('period'),'30'); assert.equal(uri.searchParams.get('algorithm'),'SHA1');
});
test('TOTP ciphertext authenticates user, phase, key and bytes and never stores a plaintext seed', () => {
  const key = randomBytes(32), value = encryptTotpSecret(secret,key,'user-1','pending');
  assert.equal(decryptTotpSecret(value,key,'user-1','pending'),secret); assert.equal(value.includes(secret),false);
  for (const [k,user,phase,cipher] of [[randomBytes(32),'user-1','pending',value],[key,'user-2','pending',value],[key,'user-1','active',value],[key,'user-1','pending',value.slice(0,-5)]]) {
    assert.throws(()=>decryptTotpSecret(cipher,k,user,phase),{code:'TFA_KEY_INVALID'});
  }
});
test('native TOTP configuration is optional, strictly validated, and has fixed security defaults', () => {
  assert.equal(loadConfig({}).auth.totpKey,null); assert.equal(totpKey(null),null);assert.equal(loadConfig({}).auth.rateLimit.actionMax,5);
  const value=randomBytes(32).toString('hex');assert.equal(loadConfig({AUTH_TOTP_KEY:value}).auth.totpKey,value);assert.equal(totpKey(value).length,32);
  for(const bad of ['short','z'.repeat(64),'a'.repeat(63),'a'.repeat(65)])assert.throws(()=>loadConfig({AUTH_TOTP_KEY:bad}),{code:'TFA_KEY_INVALID'});
  assert.deepEqual(TOTP_POLICY,{digits:6,period:30,window:1,recoveryCodes:8,challengeTtlMs:300000,enrollmentTtlMs:600000,maxAttempts:10,challengeAttempts:5,lockMs:300000});
});
test('recovery code parsing permits display separators and case but rejects shortened, mistyped or ambiguous input', () => {
  assert.equal(normalizeRecoveryCode('ABCD-'.repeat(7)+'ABCD'),'abcd'.repeat(8));
  for(const value of [null,1234,'a'.repeat(31),'g'.repeat(32),' a'.repeat(32)])assert.equal(normalizeRecoveryCode(value),null);
});
test('native TOTP migration is additive with owned credential/challenge rows and cascading user cleanup', () => {
  const migration=CORE_MIGRATIONS.at(-1);assert.equal(migration.id,'0027-native-totp');assert.equal(migration.statements.length,2);
  assert.ok(migration.statements.every(sql=>sql.includes('ON DELETE CASCADE')));
  assert.match(migration.statements[0],/secret_ciphertext TEXT NULL/);assert.match(migration.statements[1],/password_fingerprint CHAR\(64\)/);
  assert.equal(migration.statements.some(sql=>/DROP|ALTER TABLE yuncms_users/.test(sql)),false);
});

test('generated CLI environments expose the optional TOTP setting without an implicit shared key', async () => {
  const { collectEnvironment } = await import('../../cli/src/init-command.js');
  const environment = await collectEnvironment({ line: async (_label, options) => options?.defaultValue ?? 'owned', secret: async () => 'owned-db-password' });
  assert.equal(environment.AUTH_TOTP_KEY,'');assert.equal(loadConfig(environment).auth.totpKey,null);
  const { readFile } = await import('node:fs/promises');
  const compose = await readFile(new URL('../../../compose.yaml', import.meta.url), 'utf8');
  assert.match(compose, /AUTH_TOTP_KEY: \$\{AUTH_TOTP_KEY:-\}/);
});

test('the TOTP bridge does not mint a session from a raw user id or a serialized admission flag', async () => {
  const { TotpService,createPublicAccountability }=await import('../src/index.js');
  const service=new TotpService({accountability:createPublicAccountability(),database:{}});
  await assert.rejects(service.startLogin({id:'unverified-user'}),{code:'FORBIDDEN'});
  await assert.rejects(service.startLogin({id:'unverified-user'},{primary_factor_verified:true}),{code:'FORBIDDEN'});
});
