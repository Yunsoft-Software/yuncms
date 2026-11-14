import {test,expect} from '@playwright/test';
import {stateChoices} from '../helpers/ai-field-choices.mjs';

test('browser MCP schema exposes exact declared choices without arbitrary interface settings',async({page,request,baseURL})=>{
  const login=await request.post('/auth/login',{data:{email:'flows-admin@example.test',password:'Browser-flow-fixture-123!'}});
  expect(login.status()).toBe(200);
  const {access_token}= (await login.json()).data,headers={authorization:'Bearer '+access_token};
  const collection='browser_choices_'+crypto.randomUUID().replaceAll('-','').slice(0,8),endpoint=new URL(baseURL);
  const before=await request.get('/mcp/settings',{headers});expect(before.status()).toBe(200);
  const {updated_at,...settings}=(await before.json()).data;
  let created=false;
  try{
    expect((await request.post('/schema/collections',{headers,data:{collection}})).status()).toBe(201);created=true;
    expect((await request.post('/schema/collections/'+collection+'/fields',{headers,data:{field:'state',type:'string',interface:'select-dropdown',options:{choices:[{value:'Yeni',text:'Yeni'},{value:'Tamamlandı',label:'Tamamlandı'}],private_setting:'DO_NOT_EXPOSE'}}})).status()).toBe(201);
    expect((await request.patch('/mcp/settings',{headers,data:{enabled:true,writes_enabled:false,require_authentication:true,allowed_hosts:[endpoint.host],allowed_origins:[endpoint.origin]}})).status()).toBe(200);
    await page.goto('/health');
    const inspect=()=>page.evaluate(async({access_token,collection})=>{
      async function rpc(id,method,params){
        const response=await fetch('/mcp',{method:'POST',headers:{authorization:'Bearer '+access_token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
        if(response.status!==200)throw Error('Native MCP request failed: '+response.status);
        const text=await response.text();
        return JSON.parse(text.trim().startsWith('{')?text:text.split('\n').filter(line=>line.startsWith('data: ')).at(-1).slice(6));
      }
      const initialized=await rpc(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Choice browser acceptance',version:'1'}});
      if(!initialized.result)throw Error('Native MCP initialization failed');
      const result=await rpc(2,'tools/call',{name:'schema.describe_collection',arguments:{collection}});
      if(result.result.isError)throw Error('Native schema description failed');
      return JSON.parse(result.result.content[0].text).data;
    },{access_token,collection});
    for(let pass=0;pass<2;pass++){
      const described=await inspect();expect(described.fields.find(field=>field.field==='state').choices).toEqual(stateChoices);
      expect(JSON.stringify(described)).not.toContain('DO_NOT_EXPOSE');
      if(pass===0)await page.reload();
    }
  }finally{
    try{expect((await request.patch('/mcp/settings',{headers,data:settings})).status()).toBe(200);}
    finally{if(created)expect((await request.delete('/schema/collections/'+collection+'?destructive=true',{headers})).status()).toBe(204);}
  }
});
