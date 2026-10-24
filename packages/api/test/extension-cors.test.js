import test from 'node:test';import assert from 'node:assert/strict';import {validateExtensionManifest} from '../src/extensions/manifest.js';
test('customCors is an explicit endpoint boolean and never enables a hook or default extension',()=>{
 const base={type:'endpoint',id:'cors',entry:'./index.js'};
 for(const value of[undefined,false])assert.equal(validateExtensionManifest({yuncms:{...base,...(value===undefined?{}:{customCors:value})}},'/tmp').customCors,undefined);
 assert.equal(validateExtensionManifest({yuncms:{...base,customCors:true}},'/tmp').customCors,true);
 for(const customCors of['true',{},[]])assert.throws(()=>validateExtensionManifest({yuncms:{...base,customCors}},'/tmp'),{code:'INVALID_EXTENSION_MANIFEST'});
 assert.throws(()=>validateExtensionManifest({yuncms:{...base,type:'hook',customCors:true}},'/tmp'),{code:'INVALID_EXTENSION_MANIFEST'});
});
