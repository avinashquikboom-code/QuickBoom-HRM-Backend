import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {prisma} from "../src/utils/db";
import * as work from "../src/pos/workSessions";
import * as pos from "../src/pos/service";
import {Actor} from "../src/pos/auth";
async function main() {
  const url = new URL(process.env.POS_TEST_DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "55439" && url.pathname.includes("pos_test") && process.env.DATABASE_URL === process.env.POS_TEST_DATABASE_URL, "Isolated test database required");
  const suffix = randomUUID().slice(0,8);
  const store = await prisma.store.create({data: {name: `Work ${suffix}`}});
  const otherStore = await prisma.store.create({data: {name: `Other ${suffix}`}});
  await prisma.workMode.upsert({where: {id: "OFFICE"}, create: {id: "OFFICE", name: "Office"}, update: {}});
  async function employee(index: number, storeId = store.id): Promise<Actor> {
    const user = await prisma.user.create({data: {email: `work-${suffix}-${index}@test.invalid`, password: "unused", role: "EMPLOYEE"}});
    const emp = await prisma.employee.create({data: {userId: user.id, employeeCode: `${suffix}-${index}`, firstName: "Work", lastName: "Tester", storeId}});
    return {userId: user.id, employeeId: emp.id, storeId, role: "EMPLOYEE", admin: false, permissions: {"pos.sell": true, "pos.discount": true}};
  }
  const actor = await employee(1), other = await employee(2), elsewhere = await employee(3, otherStore.id);
  const admin = {...actor, admin: true};
  const register = await prisma.pOSRegister.create({data: {storeId: store.id, name: suffix}});
  const session = await pos.openRegister(actor, register.id, {openingCash: "500"});
  const product = await pos.createProduct(admin, {name: suffix, code: suffix, variants: [{sku: suffix, barcode: suffix, sellingPrice: "100", costPrice: "30", taxRate: "5"}]});
  const variant = product.variants[0]!;
  await pos.adjust(admin, {storeId: store.id, variantId: variant.id, quantityDelta: 10, type: "OPENING", reason: "test"});
  const snapshot = {version: 1, screen: "billing", cart: [
    {cartId: randomUUID(), variantId: variant.id, productId: product.id, name: product.name, sku: variant.sku, barcode: suffix, quantity: 2, unitPrice: 100, discountPerUnit: 5, discountPercent: 5, taxRate: 5, stockAvailable: 10, salesmanId: actor.employeeId},
    {cartId: randomUUID(), variantId: null, productId: null, isManual: true, name: " Partially entered manual product ", barcode: "MANUAL", sku: "", quantity: 1, unitPrice: 50, discountPercent: 10, discountPerUnit: 5, discountType: "percent", taxRate: 18, stockAvailable: 0, salesmanId: other.employeeId}
  ], customerName: "Customer", customerPhone: "9990001234", paymentMode: "CASH", cashTenderAmount: "300", paymentReference: "BANK-REFERENCE", splits: [{method: "UPI", amount: "10"}], orderDiscount: "5", defaultSalesmanId: actor.employeeId, bottomSearchQuery: "unfinished scan"};
  const request: any = {storeId: store.id, sessionId: session.id, snapshot, revision: 0, requestKey: randomUUID()};
  const saved = await work.savePOSWork(actor, request);
  assert.deepEqual(saved.draft!.snapshot, snapshot);
  assert.equal(await pos.transaction(tx=>work.checkoutPOSWork(tx,actor,store.id,undefined,undefined,true)),null);
  const replay = await work.savePOSWork(actor, request);assert.equal(replay.draft!.revision, saved.draft!.revision);
  await assert.rejects(()=>work.savePOSWork(actor, {...request,draftId:saved.draft!.id,revision:saved.draft!.revision}, true), /new key/);
  const pauseRequest = {...request, draftId: saved.draft!.id, revision: saved.draft!.revision, requestKey: randomUUID()};
  const pauses = await Promise.all([work.savePOSWork(actor, pauseRequest, true),work.savePOSWork(actor, pauseRequest, true)]);
  const pause = pauses[0].activeBreak!;
  assert.equal(pauses[1].activeBreak!.id, pause.id);
  assert.equal(await prisma.pOSWorkBreak.count({where: {draftId: saved.draft!.id}}),1);
  await assert.rejects(()=>pos.transaction(tx=>work.checkoutPOSWork(tx,actor,store.id,undefined,undefined,true)),/on break/);
  const restored = await work.getPOSWork(actor);assert.deepEqual(restored.draft!.snapshot, snapshot);
  assert.equal((await work.getPOSWork(other)).draft,null);
  await assert.rejects(()=>work.resumePOSWork(other, {breakId: pause.id}), /not found/);
  await assert.rejects(()=>work.savePOSWork(elsewhere, request), /Store access denied/);
  await assert.rejects(()=>work.getPOSWork({...actor,isPosStoreSession:true}), /personal employee account/);
  await assert.rejects(()=>work.savePOSWork(actor, {...pauseRequest,requestKey:randomUUID()}), /on break/);
  const items = [{variantId:variant.id,quantity:2,discountPerUnit:"5",salespersonId:actor.employeeId},{manual:true,name:"Manual",quantity:1,unitPrice:"50",taxRate:"18",discountPerUnit:"5",salespersonId:other.employeeId}];
  const quote = await pos.quote(actor,{storeId:store.id,items,orderDiscount:"5"});
  const saleRequest:any={storeId:store.id,sessionId:session.id,items,orderDiscount:"5",payments:[{method:"CASH",amount:quote.grandTotal.toString()}],idempotencyKey:randomUUID(),billingDraftId:saved.draft!.id,billingDraftRevision:restored.draft!.revision};
  await assert.rejects(()=>pos.checkout(actor,saleRequest), /on break/);
  assert.equal(await prisma.pOSSale.count({where:{storeId:store.id}}),0);
  assert.equal((await prisma.pOSInventoryBalance.findUniqueOrThrow({where:{storeId_variantId:{storeId:store.id,variantId:variant.id}}})).quantity,10);
  assert.equal(await prisma.pOSSalePayment.count({where:{sale:{storeId:store.id}}}),0);
  await prisma.pOSSession.update({where:{id:session.id},data:{closedAt:new Date()}});
  assert.equal((await work.getPOSWork(actor)).requiresRegisterSession,true);
  await assert.rejects(()=>work.resumePOSWork(actor,{breakId:pause.id}),/register session is closed/);
  const nextSession=await pos.openRegister(actor,register.id,{openingCash:"500"});
  await prisma.pOSWorkBreak.update({where:{id:pause.id},data:{startedAt:new Date(Date.now()-65000)}});
  const resumed=await Promise.all([work.resumePOSWork(actor,{breakId:pause.id,sessionId:nextSession.id}),work.resumePOSWork(actor,{breakId:pause.id,sessionId:nextSession.id})]);
  assert.equal(resumed[0].activeBreak,null);assert.deepEqual(resumed[0].draft!.snapshot,snapshot);
  const ended=await prisma.pOSWorkBreak.findUniqueOrThrow({where:{id:pause.id}});assert(ended.endedAt);assert(ended.durationSeconds!>=65);assert.equal(ended.durationSeconds,Math.floor((ended.endedAt!.getTime()-ended.startedAt.getTime())/1000));
  assert.equal(await prisma.pOSAuditLog.count({where:{entityId:saved.draft!.id,action:"POS_BREAK_ENDED"}}),1);
  await assert.rejects(()=>work.savePOSWork(actor,{...pauseRequest,requestKey:randomUUID()}),/another tab/);
  await assert.rejects(()=>work.savePOSWork(actor,{...request,snapshot:{...snapshot,cardNumber:"4111111111111111"}}),/Unexpected/);
  const finalRequest={...saleRequest,sessionId:nextSession.id,billingDraftRevision:resumed[0].draft!.revision};
  const sales=await Promise.all([pos.checkout(actor,finalRequest),pos.checkout(actor,finalRequest)]);assert.equal(sales[0].id,sales[1].id);
  assert.equal(await prisma.pOSSale.count({where:{storeId:store.id}}),1);
  const completed=await prisma.pOSBillingDraft.findUniqueOrThrow({where:{id:saved.draft!.id}});assert.equal(completed.saleId,sales[0].id);assert.equal(completed.status,"COMPLETED");
  assert.equal((await work.getPOSWork(actor)).draft,null);
  assert.equal((await prisma.pOSInventoryBalance.findUniqueOrThrow({where:{storeId_variantId:{storeId:store.id,variantId:variant.id}}})).quantity,8);
  assert.equal((await prisma.pOSSession.findUniqueOrThrow({where:{id:nextSession.id}})).openingCash.toString(),"500");
  console.log("PASS real PostgreSQL draft fidelity, concurrent idempotent breaks/resumes, ownership/store guards, on-break checkout rejection, no pre-sale stock/payment mutation, closed-register recovery, timestamps/audit, optimistic conflicts, credential rejection and exactly one invoice.");
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect()).then(()=>process.exit(process.exitCode ? Number(process.exitCode) : 0));
