import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { prisma } from '../src/utils/db';
import routes from '../src/pos/routes';
import { authenticateStorePassword } from '../src/pos/storeCredentials';
import { signAccessToken } from '../src/utils/jwt';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert(['localhost','127.0.0.1'].includes(url.hostname) && url.port === '55439' && url.pathname.includes('pos_test') && process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL, 'Isolated POS test database required');
  const key = randomUUID();
  await prisma.workMode.upsert({where:{id:'OFFICE'},create:{id:'OFFICE',name:'Office'},update:{}});
  const stores = await Promise.all(['A','B','Empty'].map(name => prisma.store.create({data:{name:`Cashier ${name} ${key}`}})));
  const employees = await Promise.all([['Asha','Patel',0],['Rahul','Sharma',0],['Meera','Shah',1],['Inactive','Cashier',0]].map(([firstName,lastName,store]) => prisma.employee.create({data:{firstName:String(firstName),lastName:String(lastName),employeeCode:randomUUID(),storeId:stores[Number(store)].id,status:firstName === 'Inactive' ? 'inactive' : 'active'}})));
  const tokens: string[] = [];
  for (const store of stores) {
    const login = await authenticateStorePassword(store.id,'123456');
    assert(!login.error);
    tokens.push(signAccessToken({id:login.userId!,role:'STORE_POS',storeId:store.id,isPosStoreSession:true,credentialVersion:login.version}));
  }
  const app = express(); app.use(express.json()); app.use('/pos',routes);
  const server = app.listen(0,'127.0.0.1'); await new Promise<void>(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/pos`;
  async function request(store: number, path: string, body?: unknown, expected = 200) {
    const response = await fetch(base+path,{headers:{Authorization:`Bearer ${tokens[store]}`,'Content-Type':'application/json'},...(body === undefined ? {} : {method:'POST',body:JSON.stringify(body)})});
    const text = await response.text(); assert.equal(response.status,expected,text);
    return JSON.parse(text).data;
  }
  try {
    assert.deepEqual((await request(0,`/cashiers?storeId=${stores[0].id}`)).map((e:any)=>e.id).sort(),employees.slice(0,2).map(e=>e.id).sort());
    assert.deepEqual(await request(2,`/cashiers?storeId=${stores[2].id}`),[]);
    await request(0,`/cashiers?storeId=${stores[1].id}`,undefined,403);
    const registers = await Promise.all([0,0,1].map((store,i)=>prisma.pOSRegister.create({data:{storeId:stores[store].id,name:`Counter ${i}`}})));
    const opening = {storeId:stores[0].id,registerId:registers[0].id,openingCash:'100'};
    await request(0,'/sessions/open',opening,400);
    for (const invalid of [employees[2].id,employees[3].id,999999]) await request(0,'/sessions/open',{...opening,cashierEmployeeId:invalid},403);
    await request(0,'/sessions/open',{...opening,cashierEmployeeId:"not-an-id"},400);
    await request(0,`/registers/${registers[0].id}/open`,{openingCash:'100'},400);
    console.log('PASS required cashier, active store assignment, typed IDs, empty store, store scope and both opening endpoints');
    const sessions: any[] = [];
    for (let i=0;i<3;i++) {
      const store = i===2 ? 1 : 0;
      const body = {storeId:stores[store].id,registerId:registers[i].id,openingCash:'100',cashierEmployeeId:i === 1 ? String(employees[i].id) : employees[i].id};
      const session = await request(store,'/sessions/open',body); sessions.push(session);
      const name = `${employees[i].firstName} ${employees[i].lastName}`;
      assert.equal(session.cashierName,name); assert.equal(session.employeeId,employees[i].id);
      assert.equal((await request(store,'/sessions/open',body)).id,session.id);
      const salesperson = employees[i === 2 ? 2 : 1];
      const sale = await request(store,'/sales',{storeId:stores[store].id,sessionId:session.id,salespersonId:salesperson.id,
        items:[{manual:true,name:'Cashier identity test item',quantity:1,unitPrice:'10',taxRate:'0',salespersonId:salesperson.id}],
        orderDiscount:'0',payments:[{method:'CASH',amount:'10'}],idempotencyKey:randomUUID()});
      const detail = await request(store,`/sales/${sale.id}`); assert.equal(`${detail.cashier.employee.firstName} ${detail.cashier.employee.lastName}`,name); assert.equal(detail.salespersonId,salesperson.id);
      assert.equal(detail.items[0].salespersonId,salesperson.id);
      const bills = await request(store,`/sales?storeId=${stores[store].id}`); const bill=bills.items.find((s:any)=>s.id===sale.id); assert.equal(bill.cashier.employee.id,employees[i].id);
      const sessionBills = await request(store,`/sessions/${session.id}/sales`); assert.equal(sessionBills.items[0].cashier.employee.id,employees[i].id);
      assert.equal((await request(store,`/sessions/${session.id}/summary`)).summary.cashierName,name);
      assert.equal((await request(store,`/registers/${registers[i].id}/sessions`))[0].cashierName,name);
      assert.equal((await request(store,`/sessions?storeId=${stores[store].id}`)).items.find((s:any)=>s.id===session.id).cashierName,name);
      assert.equal((await request(store,`/reports/registers?storeId=${stores[store].id}`)).items.find((s:any)=>s.id===session.id).cashierName,name);
      const exportResponse = await fetch(base+'/bill-exports/download',{method:'POST',headers:{Authorization:`Bearer ${tokens[store]}`,'Content-Type':'application/json'},body:JSON.stringify({storeId:stores[store].id,format:'csv',saleIds:[sale.id]})});
      assert.equal(exportResponse.status,200); assert((await exportResponse.text()).includes(name));
      const closed = await request(store,`/sessions/${session.id}/close`,{actualCash:'110'}); assert.equal(closed.cashierName,name);
      console.log(`PASS ${name}: open, resume, bill detail/list/session history, unchanged salesperson, summary, register history, reconciliation, CSV, close`);
    }
    // A different selected cashier must not silently resume another employee's session.
    const first=await request(0,'/sessions/open',{...opening,cashierEmployeeId:employees[0].id});
    await request(0,'/sessions/open',{...opening,cashierEmployeeId:employees[1].id},409);
    const second=await request(0,'/sessions/open',{...opening,registerId:registers[1].id,cashierEmployeeId:employees[1].id});
    assert.notEqual(first.id,second.id);
    const current=await request(0,`/sessions/current?storeId=${stores[0].id}`);
    const names=current.registers.flatMap((r:any)=>r.sessions).map((session:any)=>session.cashierName);
    assert(names.includes('Asha Patel') && names.includes('Rahul Sharma'));
    assert.equal((await request(0,`/sessions/${first.id}/summary`)).summary.cashierName,'Asha Patel');
    await request(0,`/sessions/${second.id}/close`,{actualCash:'100'});
    await prisma.pOSSession.update({where:{id:first.id},data:{employeeId:null}});
    assert.equal((await request(0,`/sessions/${first.id}/summary`)).summary.cashierName,'Unknown Cashier');
    const saleBody={storeId:stores[0].id,salespersonId:employees[1].id,items:[{manual:true,name:'Legacy guard',quantity:1,unitPrice:'10',taxRate:'0'}],payments:[{method:'CASH',amount:'10'}],idempotencyKey:randomUUID()};
    await request(0,'/sales',{...saleBody,sessionId:first.id},409);
    await request(0,'/sales',{...saleBody,idempotencyKey:randomUUID()},409);
    assert.equal((await request(0,`/sessions/${first.id}/close`,{actualCash:'100'})).employeeId,null);
    console.log('PASS cashier conflict and legacy sessions retain missing identity without arbitrary historical assignment');
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();process.exit(process.exitCode??0);});
