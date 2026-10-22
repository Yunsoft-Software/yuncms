import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { authenticationResult, factorVerification } from '../src/two-factor.js';
import { readStudioRoute, studioPath } from '../src/studio-route.js';
import { TFA_LOCALES } from '../src/locales/two-factor.js';

test('a second-factor challenge cannot be mistaken for an authenticated Studio session', () => {
  assert.equal(authenticationResult({mfa_required:true,challenge_token:'ycm_pending'}),'challenge');
  assert.equal(authenticationResult({access_token:'access',refresh_token:'refresh',user:{id:'user'}}),'session');
  for(const result of [null,{}, {access_token:'x'}, {mfa_required:true}])assert.throws(()=>authenticationResult(result));
  assert.deepEqual(factorVerification('123456'),{code:'123456'});assert.deepEqual(factorVerification('backup',true),{recovery_code:'backup'});
});
test('the self-service security route is native and discoverable without administrator-only navigation', async () => {
  assert.equal(studioPath.security(),'#/security');assert.equal(readStudioRoute('#/security').section,'security');
  const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');assert.match(app,/id: 'security', labelKey: 'tfa.title', icon: 'roles' \}/);assert.match(app,/security: studioPath.security\(\)/);
});
test('local, LDAP and browser handoff helpers persist only complete sessions; the same shared factor input is used for login and management', async () => {
  const api=await readFile(new URL('../src/api.js',import.meta.url),'utf8');assert.equal(api.match(/if \(authenticationResult\(body.data\) === 'session'\) writeSession\(body.data\)/g)?.length,3);
  for(const path of ['../src/screens/LoginScreen.jsx','../src/components/TwoFactorPanel.jsx']){
    const text=await readFile(new URL(path,import.meta.url),'utf8');assert.match(text,/<SecondFactorInput/);assert.doesNotMatch(text,/window\.(prompt|alert)|style=\{/);
  }
  const barrel=await readFile(new URL('../src/components/index.js',import.meta.url),'utf8');assert.match(barrel,/export \{ TwoFactorPanel \}/);assert.match(barrel,/export \{ SecondFactorInput \}/);
});
test('all supported locales supply the complete two-factor workflow vocabulary', () => {
  const keys=Object.keys(TFA_LOCALES.en).sort();assert.equal(Object.keys(TFA_LOCALES).length,8);
  for(const locale of Object.values(TFA_LOCALES)){assert.deepEqual(Object.keys(locale).sort(),keys);assert.ok(Object.values(locale).every(v=>typeof v==='string'&&v.length>0));}
});
