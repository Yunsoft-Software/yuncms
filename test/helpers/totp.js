import { createHmac } from 'node:crypto';
// Independent authenticator-side calculation for real HTTP/browser acceptance.
export function authenticatorCode(secret, step = Math.floor(Date.now()/30000)) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bits=[...secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join('');
  const key=Buffer.from(bits.match(/.{8}/g).map(byte=>parseInt(byte,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const mac=createHmac('sha1',key).update(counter).digest(),offset=mac[19]&15;
  return String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
export async function nextAuthenticatorPeriod(lastStep) {
  const deadline=Date.now()+32000;
  while(Math.floor(Date.now()/30000)<=Number(lastStep)){
    if(Date.now()>deadline)throw Error('Real authenticator clock did not advance');
    await new Promise(resolve=>setTimeout(resolve,200));
  }
}

export function incorrectAuthenticatorCode(secret) {
 const current=Math.floor(Date.now()/30000),valid=new Set([current-1,current,current+1].map(s=>authenticatorCode(secret,s)));
 for(let i=0;i<10;i++){const value=String(i).padStart(6,'0');if(!valid.has(value))return value;}
 throw Error('No invalid code available');
}
