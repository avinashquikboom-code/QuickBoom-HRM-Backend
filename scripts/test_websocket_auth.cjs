const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const Module = require('node:module');
require('ts-node/register/transpile-only');
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const jwt = require('jsonwebtoken');
const load = Module._load;
Module._load = function(name,parent,isMain) {
 if (/(?:^|\/)utils\/db$/.test(name)) return {prisma:{user:{findUnique:async ({where})=>({id:where.id,isActive:where.id!==2,role:'SALESMAN',employee:{id:10,status:'ACTIVE'}})}}};
 if (/leaveBalanceService$/.test(name)) return {default:{}};
 return load.call(this,name,parent,isMain);
};
const WebSocketService = require('../src/services/websocketService').default;
Module._load = load;
const server = http.createServer();
const service = new WebSocketService(server);
const handshake = token => new Promise((resolve,reject)=>{
 const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);
 const timeout=setTimeout(()=>{ws.close();reject(Error('Handshake timeout'));},5000);
 ws.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Transport failed'));});
 ws.addEventListener('message',({data})=>{
  const message=String(data);
  if(message.startsWith('0')) ws.send('40'+JSON.stringify({token}));
  if(message.startsWith('40')||message.startsWith('44')) {
   clearTimeout(timeout);ws.close();resolve({ok:message.startsWith('40'),data:JSON.parse(message.slice(2))});
  }
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const valid=jwt.sign({id:1,role:'SALESMAN'},process.env.JWT_SECRET,{expiresIn:3600});
  assert.equal((await handshake(valid)).ok,true);
  const expired=jwt.sign({id:1,role:'SALESMAN'},process.env.JWT_SECRET,{expiresIn:-1});
  const denied=await handshake(expired);assert.equal(denied.ok,false);assert.equal(denied.data.data.code,'TOKEN_EXPIRED');
  const invalid=await handshake('invalid');assert.equal(invalid.ok,false);assert.equal(invalid.data.data.code,'AUTH_INVALID');
  const bearer=await handshake(`Bearer ${valid}`);assert.equal(bearer.ok,false);
  assert.equal((await handshake(null)).data.data.code,'AUTH_REQUIRED');
  assert.equal((await handshake(jwt.sign({id:2,role:'SALESMAN'},process.env.JWT_SECRET,{expiresIn:3600}))).data.data.code,'ACCOUNT_INACTIVE');
  assert.equal((await handshake(valid)).ok,true,'A renewed valid token connects after expiry rejection');
  console.log('PASS real Socket.IO/WebSocket handshakes: valid, expired, invalid, missing, Bearer-prefixed, inactive and valid reconnection. DB mocked; ephemeral test JWT key only.');
 } finally { await new Promise(resolve=>service.getServer().close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
