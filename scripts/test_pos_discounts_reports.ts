import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import ExcelJS from "exceljs";
import { prisma } from "../src/utils/db";
import { Prisma } from "@prisma/client";
import * as pos from "../src/pos/service";
import { billTotals, lineTotals } from "../src/pos/finance";
import { reportingOverview, reportingDetails } from "../src/pos/reporting";
import { Actor } from "../src/pos/auth";
import routes from "../src/pos/routes";
import { signAccessToken } from "../src/utils/jwt";
import { receiptFromSale } from "../../HRM-Admin-Pannel/src/features/pos/posReceipt";
const D=Prisma.Decimal;
let passed=0;
async function test(name:string,fn:()=>Promise<void>|void){await fn();console.log(`PASS ${name}`);passed++;}
async function main(){
 await test("seven requested discount examples and GST before-tax calculation",()=>{
  for(const [price,qty,value,type,tax,expected] of [[1000,1,10,"percent",0,900],[1000,2,10,"percent",0,1800],[1000,1,100,"amount",0,900],[1000,2,100,"amount",0,1800],[100,1,0,"percent",0,100],[100,1,100,"amount",0,0],[1000,1,10,"percent",18,1062]] as const)
   assert.equal(Number(lineTotals(new D(price),qty,new D(value),new D(tax),type).lineTotal),expected);
 });
 await test("percentage rounds once on gross, preserving multi-unit decimal cents",()=>{
  const l=lineTotals(new D("1000.05"),3,new D("12.5"),new D(0),"percent");assert.equal(l.discountTotal.toFixed(2),"375.02");assert.equal(l.lineTotal.toFixed(2),"2625.13");
  const b=billTotals([{price:new D(".05"),quantity:3,discount:new D(10),discountType:"percent",taxRate:new D(0)}]);assert.equal(b.discountTotal.toFixed(2),"0.02");assert.equal(b.grandTotal.toFixed(2),"0.13");
 });
 const url=new URL(process.env.POS_TEST_DATABASE_URL??"");assert(["localhost","127.0.0.1"].includes(url.hostname)&&url.port==="55439"&&url.pathname.includes("pos_test")&&process.env.DATABASE_URL===process.env.POS_TEST_DATABASE_URL,"Isolated POS database required");
 const key=randomUUID();const user=await prisma.user.create({data:{email:`discount-${key}@test.invalid`,password:"test",role:"ADMIN"}});
 const store=await prisma.store.create({data:{name:`Discount reports ${key}`}}),other=await prisma.store.create({data:{name:`Other ${key}`}});
 await prisma.workMode.upsert({where:{id:"OFFICE"},create:{id:"OFFICE",name:"Office"},update:{}});
 const emp=await prisma.employee.create({data:{employeeCode:key,firstName:"Discount",lastName:"Seller",status:"active",source:"HOPKID",storeId:store.id}});
 const actor:Actor={userId:user.id,role:"ADMIN",admin:true,permissions:{}};
 const reg=await prisma.pOSRegister.create({data:{storeId:store.id,name:"Test"}});const session=await pos.openRegister(actor,reg.id,{openingCash:"100"});
 const manual=(over:Record<string,unknown>={})=>({manual:true,key:randomUUID(),name:"Discounted shirt",unitPrice:"1000",quantity:1,taxRate:"0",discountType:"percent",discountValue:"10",salespersonId:emp.id,...over});
 const quote=(items:unknown[],orderDiscount="0",orderDiscountType="amount")=>pos.quote(actor,{storeId:store.id,items,orderDiscount,orderDiscountType});
 await test("backend quote accepts all valid discount examples",async()=>{
  for(const [price,qty,value,type,tax,total] of [[1000,1,10,"percent",0,900],[1000,2,10,"percent",0,1800],[1000,1,100,"amount",0,900],[1000,2,100,"amount",0,1800],[100,1,0,"percent",0,100],[100,1,100,"amount",0,0],[1000,1,10,"percent",18,1062]] as const){const q=await quote([manual({unitPrice:String(price),quantity:qty,discountType:type,discountValue:String(value),taxRate:String(tax)})]);assert.equal(Number(q.grandTotal),total);}
 });
 await test("bill percentage/fixed discounts apply once after item discounts",async()=>{
  const items=[manual({quantity:2}),manual({unitPrice:"100",discountType:"amount",discountValue:"10"})];
  const decimal=await quote([manual({unitPrice:"2",quantity:2,discountType:"amount",discountValue:"1.005"})]);assert.equal(Number(decimal.grandTotal),1.99);
  const fine=await quote([manual({discountValue:".000001"})]);assert.equal(Number(fine.grandTotal),1000);
  const q=await quote(items,"10","percent");assert.equal(Number(q.subtotal),2100);assert.equal(Number(q.itemDiscountTotal),210);assert.equal(Number(q.orderDiscountTotal),189);assert.equal(Number(q.grandTotal),1701);
  const fixed=await quote(items,"100");assert.equal(Number(fixed.grandTotal),1790);
 });
 await test("invalid discounts, ambiguous legacy input, invalid quantity/price, excess bill discount rejected",async()=>{
  for(const bad of [{discountValue:"-1"},{discountValue:"100.0001"},{discountType:"amount",discountValue:"1001"},{quantity:0},{unitPrice:"0"},{discountType:"other"},{discountPerUnit:"10"},{discountValue:null}])await assert.rejects(quote([manual(bad)]));
  await assert.rejects(quote([manual()],"901"),/eligible/);
  const zero=await quote([manual({discountValue:""})],"");assert.equal(Number(zero.grandTotal),1000);
 });
 const make=async(items:unknown[],payments:unknown[],extra:Record<string,unknown>={})=>pos.checkout(actor,{storeId:store.id,sessionId:session.id,idempotencyKey:randomUUID(),items,payments,orderDiscount:"0",...extra});
 const a=await make([manual({quantity:2,taxRate:"18"})],[{method:"CASH",amount:"1000"},{method:"UPI",amount:"1124"}]);
 const b=await make([manual({unitPrice:"500",discountType:"amount",discountValue:"50"})],[{method:"CARD",amount:"450"}]);
 const c=await make([manual({unitPrice:"300",discountValue:"0"})],[{method:"CASH",amount:"300"}]);await pos.bulkCancelSales(actor,{saleIds:[c.id],reason:"Report cancellation fixture"});
 await test("zero-value checkout has no fake payments and receipt retains discount totals",async()=>{
  const z=await make([manual({unitPrice:"100",discountType:"amount",discountValue:"100"})],[{method:"CASH",amount:"0"}]);assert.equal(Number(z.grandTotal),0);assert.equal(z.payments.length,0);const receipt=receiptFromSale({...z,store});assert.equal(receipt.discount,100);assert.equal(receipt.totalAmount,0);assert.equal(receipt.paymentMode,"No payment due");
  const r=receiptFromSale({...a,store});assert.equal(r.discount,200);assert.equal(r.tax,324);assert.equal(r.totalAmount,2124);
 });
 await test("overview reconciles saved bills, payments and cancellations",async()=>{
  const r=await reportingOverview(actor,{storeId:store.id});assert.equal(Number(r.collected),2574);assert.equal(r.bills,3);assert.equal(r.cancelledBills,1);assert.equal(Number(r.discounts),350);assert.equal(Number(r.tax),324);assert.equal(r.itemsSold,4);assert.equal(Number(r.payments.find((p:any)=>p.method==="CASH").amount),1000);
 });
 await test("all eleven report SQL paths return real rows and recorded tax",async()=>{
  for(const report of ["sales","invoices","payments","products","discounts","tax","employees","stores","sessions","cancelled","returns"]){const r=await reportingDetails(actor,{storeId:store.id,report});assert(Array.isArray(r.items),report);if(report!=="returns")assert(r.items.length>0,report);if(report==="tax")assert(r.items.every((i:any)=>i.cgst===null&&i.sgst===null));if(report==="cancelled")assert.equal(r.items[0].invoiceNo,c.invoiceNo);}
 });
 await test("filters, grouping, pagination, previous period and authorization",async()=>{
  const own=await reportingDetails(actor,{storeId:store.id,report:"invoices",search:a.invoiceNo,pageSize:1});assert.equal(own.total,1);
  const cash=await reportingOverview(actor,{storeId:store.id,paymentMode:"CASH"});assert.equal(Number(cash.collected),2124);
  const cashRows=await reportingDetails(actor,{storeId:store.id,report:"payments",paymentMode:"CASH"});assert.equal(cashRows.items.length,1);assert.equal(Number(cashRows.items[0].amount),1000);
  const cancelled=await reportingOverview(actor,{storeId:store.id,status:"CANCELLED"});assert.equal(Number(cancelled.collected),0);
  for(const groupBy of ["hour","day","week","month"])assert((await reportingDetails(actor,{storeId:store.id,report:"sales",groupBy})).items.length);
  const restricted:Actor={userId:user.id,role:"EMPLOYEE",admin:false,storeId:store.id,permissions:{"pos.read":true,"pos.reports":true}};
  await assert.rejects(reportingOverview(restricted,{storeId:other.id}),/denied/);await assert.rejects(reportingOverview(restricted,{storeId:"*"}),/denied/);
  await assert.rejects(reportingDetails(actor,{storeId:store.id,report:"bad"}));await assert.rejects(reportingDetails(actor,{storeId:store.id,report:"sales",from:"2026-10-24",to:"2026-10-01"}));
 });
 await test("grouped discounts and payment totals classify new recorded data correctly",async()=>{
  for(const groupBy of ["day","store","employee"]){const r=await reportingDetails(actor,{storeId:store.id,report:"discounts",groupBy});assert.equal(Number(r.items[0].discountTotal),350);assert.equal(Number(r.items[0].percentageDiscount),200);assert.equal(Number(r.items[0].fixedDiscount),150);}
  for(const groupBy of ["day","store"]){const r=await reportingDetails(actor,{storeId:store.id,report:"payments",groupBy});assert.equal(r.items.reduce((n:number,p:any)=>n+Number(p.amount),0),2574);}
 });
 await test("deleted invoices disappear from all completed-sale aggregates",async()=>{
  const extra=await make([manual({unitPrice:"90",discountValue:"0"})],[{method:"CASH",amount:"90"}]);
  assert.equal(Number((await reportingOverview(actor,{storeId:store.id})).collected),2664);
  await pos.deleteSale(actor,extra.id,{reason:"Isolated report deletion test"});
  assert.equal(Number((await reportingOverview(actor,{storeId:store.id})).collected),2574);
  assert.equal((await reportingDetails(actor,{storeId:store.id,report:"invoices",search:extra.invoiceNo})).total,0);
 });
 await test("multi-store consolidated totals stay scoped and match store totals",async()=>{
  const before=await reportingOverview(actor,{storeId:"*"});
  const r=await prisma.pOSRegister.create({data:{storeId:other.id,name:"Other register"}});const ss=await pos.openRegister(actor,r.id,{openingCash:"0"});
  const otherSale=await pos.checkout(actor,{storeId:other.id,sessionId:ss.id,idempotencyKey:randomUUID(),orderDiscount:"0",items:[manual({salespersonId:null,unitPrice:"105",discountValue:"0"})],payments:[{method:"CASH",amount:"105"}]});
  const after=await reportingOverview(actor,{storeId:"*"});assert.equal(Number(after.collected)-Number(before.collected),105);
  assert.equal(Number((await reportingOverview(actor,{storeId:other.id})).collected),105);
  await prisma.pOSSale.update({where:{id:otherSale.id},data:{createdAt:new Date(Date.now()-86400000)}});
  const comparison=await reportingOverview(actor,{storeId:other.id});assert.equal(Number(comparison.collected),0);assert.equal(Number(comparison.previous.collected),105);
 });
 await test("cash ledger excludes voids and includes actual cash receipts only",async()=>{const s=await pos.computeSessionSummary(session.id);assert.equal(s.summary.expectedCash,1100);assert.equal(s.summary.cardSales,450);assert.equal(s.summary.upiSales,1124);});
 await test("catalog cancellations expose stock restoration and zero-sales products",async()=>{
  const product=await pos.createProduct(actor,{name:"Zero-sales cancellation test",code:randomUUID(),variants:[{sku:randomUUID(),barcode:randomUUID(),costPrice:"10",sellingPrice:"100",taxRate:"0"}]});const variant=product.variants[0];
  await pos.adjust(actor,{storeId:store.id,variantId:variant.id,quantityDelta:5,reason:"Test stock"});
  const sale=await make([{variantId:variant.id,quantity:1,discountType:"percent",discountValue:"10"}],[{method:"CASH",amount:"90"}]);await pos.bulkCancelSales(actor,{saleIds:[sale.id],reason:"Stock restoration report test"});
  const cancelled=await reportingDetails(actor,{storeId:store.id,report:"cancelled",search:sale.invoiceNo});assert.equal(cancelled.items[0].stockRestorationRecorded,true);
  const products=await reportingDetails(actor,{storeId:store.id,report:"products",search:variant.sku});assert.equal(products.items[0].quantity,0);
 });
 await test("ordinary refunds and refunded cancellations follow posting-date net accounting",async()=>{
  await pos.returnSale(actor,b.id,{sessionId:session.id,idempotencyKey:randomUUID(),reason:"Report refund test",refundMethod:"CARD",items:b.items.map(i=>({saleItemId:i.id,quantity:i.quantity,resellable:true}))});
  const paid=await make([manual({unitPrice:"100",discountValue:"0"})],[{method:"CASH",amount:"100"}]);
  await pos.cancelSale(actor,paid.id,{sessionId:session.id,idempotencyKey:randomUUID(),reason:"Refunded cancellation test",refundMethod:"CASH"});
  const summary=await reportingOverview(actor,{storeId:store.id});assert.equal(Number(summary.netCollected),2124);assert.equal(Number(summary.refunds),450);
  const returns=await reportingDetails(actor,{storeId:store.id,report:"returns"});assert.equal(returns.total,2);
  assert.equal((await pos.computeSessionSummary(session.id)).summary.expectedCash,1100);
 });
 const app=express();app.use(express.json());app.use("/api/v1/pos",routes);const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const headers={"Content-Type":"application/json",Authorization:`Bearer ${signAccessToken({id:user.id,role:"ADMIN"})}`};
 try{
 await test("real API quote and CSV/Excel report exports respect filters",async()=>{
  const result=await fetch(origin+"/api/v1/pos/quote",{method:"POST",headers,body:JSON.stringify({storeId:store.id,items:[manual({taxRate:"18"})],orderDiscount:"0"})});assert.equal(result.status,200);assert.equal(Number((await result.json() as any).data.grandTotal),1062);
  const preview=await fetch(origin+"/api/v1/pos/bill-exports/preview",{method:"POST",headers,body:JSON.stringify({storeId:store.id,search:a.invoiceNo,employeeId:String(emp.id),saleIds:[a.id],format:"csv"})});assert.equal(preview.status,200);assert.equal((await preview.json() as any).data.count,1);
  for(const report of ["sales","invoices","payments","products","discounts","tax","employees","stores","sessions","cancelled","returns"]){const r=await fetch(origin+`/api/v1/pos/reports/export?report=${report}&storeId=${store.id}&format=csv`,{headers});assert.equal(r.status,200,report+await(r.status===200?Promise.resolve(""):r.text()));assert((await r.text()).length>0);}
  for(const format of ["csv","xlsx"]){const r=await fetch(origin+`/api/v1/pos/reports/export?report=invoices&storeId=${store.id}&format=${format}&search=${a.invoiceNo}`,{headers});assert.equal(r.status,200,await(r.status===200?Promise.resolve(""):r.text()));const buffer=Buffer.from(await r.arrayBuffer());if(format==="csv"){const t=buffer.toString();assert(t.includes(a.invoiceNo));assert(!t.includes(b.invoiceNo));}else{const book=new ExcelJS.Workbook();await book.xlsx.load(buffer as any);assert.equal(book.worksheets[0].rowCount,2);}}
 });
 await test("closing reconciliation and register reports preserve actual cash",async()=>{
  const closed=await pos.closeSession(actor,session.id,{actualCash:"1100"});assert.equal(Number(closed.variance),0);
  const r=await reportingDetails(actor,{storeId:store.id,report:"sessions",sessionStatus:"CLOSED"});assert.equal(r.total,1);assert.equal(r.items[0].actualCash,1100);assert.equal(r.items[0].expectedCash,1100);
 });
 }finally{server.close();}
 console.log(`${passed} discount/report regression groups passed`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();process.exit(process.exitCode??0);});
