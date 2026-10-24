import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../src/utils/db';
import routes from '../src/pos/routes';
import { signAccessToken } from '../src/utils/jwt';
import { cashierName } from '../src/pos/cashierIdentity';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.port === '55439' && url.pathname.includes('pos_test'), 'Isolated test database required');
  const key = randomUUID().slice(0,8);
  const app = express(); app.use(express.json()); app.use('/pos', routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/pos`;
  try {
    const store = await prisma.store.create({data:{name:`Cashier test ${key}`,code:`CN${key}`}});
    await prisma.workMode.upsert({where:{id:'OFFICE'},update:{},create:{id:'OFFICE',name:'Office'}});
    const cases = [
      {firstName:' Rahul ',lastName:' Sharma ',profile:'Old Profile',expected:'Rahul Sharma'},
      {firstName:'Asha',lastName:'Patel',profile:null,expected:'Asha Patel'},
      {firstName:null,lastName:null,profile:'  Profile Cashier  ',expected:'Profile Cashier'},
      {firstName:null,lastName:null,profile:null,expected:'Unknown Cashier'},
    ];
    const sessions: string[] = [];
    let lastHeaders: Record<string,string> = {};
    for (const [i,c] of cases.entries()) {
      const user = await prisma.user.create({data:{email:`cashier-${key}-${i}@pos.test`,password:'test',role:'ADMIN',...(c.profile ? {profile:{create:{fullName:c.profile,email:`profile-${key}-${i}@pos.test`}}}: {})}});
      if(c.firstName) await prisma.employee.create({data:{userId:user.id,employeeCode:`CN${key}${i}`,firstName:c.firstName,lastName:c.lastName!,storeId:store.id}});
      const headers = {Authorization:`Bearer ${signAccessToken({id:user.id,role:user.role})}`,'Content-Type':'application/json'};
      lastHeaders = headers;
      async function request(path: string, body?: unknown) {
        const res=await fetch(base+path,{headers,...(body ? {method:'POST',body:JSON.stringify(body)} : {})});
        assert.equal(res.status,200,await res.clone().text()); return (await res.json()).data;
      }
      const context=await request(`/context?storeId=${store.id}`);
      assert.equal(context.actor.cashierName,c.expected);
      const register=await prisma.pOSRegister.create({data:{storeId:store.id,name:`Counter ${i}`}});
      const body={storeId:store.id,registerId:register.id,openingCash:'100'};
      const forged=await fetch(base+'/sessions/open',{headers,method:'POST',body:JSON.stringify({...body,cashierName:'Forged'})});
      assert.equal(forged.status,400);
      const opened=await request('/sessions/open',body); sessions.push(opened.id);
      assert.equal(opened.cashierName,c.expected);
      assert.equal((await request('/sessions/open',body)).cashierName,c.expected);
      assert.equal((await request(`/registers/${register.id}/open`,{openingCash:'100'})).cashierName,c.expected);
      const registerHistory=await request(`/registers/${register.id}/sessions`);
      assert.equal(registerHistory.find((s:any)=>s.id===opened.id).cashierName,c.expected);
      // Legacy/store terminal sessions may have no employeeId; user relationship remains authoritative.
      await prisma.pOSSession.update({where:{id:opened.id},data:{employeeId:null}});
      const summary=await request(`/sessions/${opened.id}/summary`);
      assert.equal(summary.summary.cashierName,c.expected);
      assert.equal(summary.session.storeName,store.name);
      assert.equal(summary.session.registerName,register.name);
      const current=await request(`/sessions/current?storeId=${store.id}`);
      assert.equal(current.session.cashierName,c.expected);
      const closed=await request(`/sessions/${opened.id}/close`,{actualCash:'100'});
      assert.equal(closed.cashierName,c.expected);
      const repeated=await request(`/sessions/${opened.id}/close`,{actualCash:'100'});
      assert.equal(repeated.cashierName,c.expected);
      console.log(`PASS ${c.expected}: context, opening, summary, current, closing, repeated close, input rejection`);
    }
    const historyRes=await fetch(base+`/sessions?storeId=${store.id}`,{headers:lastHeaders});
    assert.equal(historyRes.status,200);
    const history=(await historyRes.json()).data;
    for(const [i,id] of sessions.entries()) assert.equal(history.items.find((s:any)=>s.id===id).cashierName,cases[i].expected);
    assert.equal(cashierName({employee:{firstName:' ',lastName:' '},profile:{fullName:' '}}),'Unknown Cashier');
    console.log('PASS historical session owners retain their own names when viewed by another account; blank-name fallback');
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();process.exit(process.exitCode??0);});
