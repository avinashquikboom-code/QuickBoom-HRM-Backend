/** Isolated HTTP harness using the real HRM auth and POS routers; never a deployment entrypoint. */
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from '../src/utils/db';
import authRoutes from '../src/routes/authRoutes';
import posRoutes from '../src/pos/routes';
import { createProduct, adjust, openRegister } from '../src/pos/service';
import { Actor } from '../src/pos/auth';
async function main(){
 const testUrl=new URL(process.env.POS_TEST_DATABASE_URL ?? '');if(!['127.0.0.1','localhost'].includes(testUrl.hostname)||testUrl.port!=='55439'||!testUrl.pathname.includes('pos_test')||process.env.DATABASE_URL!==process.env.POS_TEST_DATABASE_URL)throw new Error('An isolated local POS test database is required');
 const suffix=randomUUID().slice(0,8);const password='isolated-browser-test';
 const user=await prisma.user.create({data:{email:`browser-${suffix}@test.invalid`,password:await bcrypt.hash(password,4),role:'ADMIN'}});
 const store=await prisma.store.create({data:{name:`Browser store ${suffix}`}});
 await prisma.workMode.upsert({where:{id:'OFFICE'},create:{id:'OFFICE',name:'Office'},update:{}});
 const employee=await prisma.employee.create({data:{userId:user.id,employeeCode:`BROWSER-${suffix}`,firstName:'Browser',lastName:'Cashier',storeId:store.id}});
 const actor:Actor={userId:user.id,employeeId:employee.id,storeId:store.id,role:user.role,admin:true,permissions:{}};
 const product=await createProduct(actor,{name:`Browser Cotton Shirt ${suffix}`,code:`BROWSER-${suffix}`,variants:[{sku:`BROWSER-M-${suffix}`,barcode:`BROWSER-${suffix}`,size:'M',color:'Black',costPrice:'50',sellingPrice:'100',taxRate:'5'}]});
 await adjust(actor,{storeId:store.id,variantId:product.variants[0]!.id,quantityDelta:10,type:'OPENING',reason:'Browser fixture opening stock'});
 const second=await createProduct(actor,{name:`Browser Denim ${suffix}`,code:`DENIM-${suffix}`,variants:[{sku:`DENIM-${suffix}`,barcode:`DENIM-BC-${suffix}`,size:'L',color:'Blue',costPrice:'80',sellingPrice:'199.95',taxRate:'12'}]});
 await adjust(actor,{storeId:store.id,variantId:second.variants[0]!.id,quantityDelta:10,type:'OPENING',reason:'Browser fixture second product'});
 const register=await prisma.pOSRegister.create({data:{storeId:store.id,name:`Browser register ${suffix}`}});const session=await openRegister(actor,register.id,{openingCash:'500'});
 const app=express();app.use(express.json());app.use('/api/auth',authRoutes);app.use('/api/v1/pos',posRoutes);
 const server=app.listen(0,'127.0.0.1',()=>{const {port}=server.address() as {port:number};console.log('POS_E2E_READY '+JSON.stringify({origin:`http://127.0.0.1:${port}`,email:user.email,userId:user.id,storeId:store.id,productName:product.name,sku:product.variants[0]!.sku,variantId:product.variants[0]!.id,barcode:product.variants[0]!.barcode,secondVariantId:second.variants[0]!.id,secondBarcode:second.variants[0]!.barcode,secondSku:second.variants[0]!.sku,registerId:register.id,sessionId:session.id}));});
 process.on('SIGTERM',()=>server.close(async()=>{await prisma.$disconnect();process.exit(0);}));
}
main().catch(async e=>{console.error(e);await prisma.$disconnect();process.exit(1);});
