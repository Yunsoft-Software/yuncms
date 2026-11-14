import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredFieldChoices } from '../src/schema-choices.js';

test('declared choices retain exact ordered scalar values and return only display labels', () => {
  assert.deepEqual(declaredFieldChoices({ options: [' Yeni ', 'Tamamlandı', 0, false, null] }), [
    {value:' Yeni ',label:' Yeni '},{value:'Tamamlandı',label:'Tamamlandı'},
    {value:0,label:'0'},{value:false,label:'false'},{value:null,label:'null'},
  ]);
  const options={choices:[{value:1,text:'One',secret:'hidden'},{value:'done',label:'Completed'},
    {value:false,text:0},{value:null,label:'None'},{value:'fallback',text:{secret:true}}],private_key:'hidden'};
  const before=JSON.stringify(options);
  assert.deepEqual(declaredFieldChoices({options}),[
    {value:1,label:'One'},{value:'done',label:'Completed'},{value:false,label:'0'},
    {value:null,label:'None'},{value:'fallback',label:'fallback'},
  ]);
  assert.equal(JSON.stringify(options),before);
  assert.deepEqual(declaredFieldChoices({options:JSON.stringify(options)}),declaredFieldChoices({options}));
});

test('absent or malformed choices do not invent status values or expose arbitrary options', () => {
  for(const metadata of [undefined,{}, {field:'status'}, {options:'broken'},
    {options:{choices:'new',secret:'hidden'}},{options:{default:'published'}}]) {
    assert.equal(declaredFieldChoices(metadata),undefined);
  }
  assert.deepEqual(declaredFieldChoices({options:[]}),[]);
  assert.deepEqual(declaredFieldChoices({options:{choices:[undefined,NaN,Infinity,[],{},
    {label:'No value'},{value:{}},{value:['bad']},{value:undefined},{value:'ok'}]}}),[{value:'ok',label:'ok'}]);
});
