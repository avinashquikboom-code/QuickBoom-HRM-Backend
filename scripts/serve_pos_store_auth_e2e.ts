import express from 'express';
import bcrypt from 'bcryptjs';
import {randomUUID} from 'crypto';
import {prisma} from '../src/utils/db';
import posRoutes from '../src/pos/routes';
import adminRoutes from '../src/routes/adminRoutes';
import authRoutes from '../src/routes/authRoutes';
import {defaultPOSCredential} from '../src/pos/storeCredentials';
import * as service from '../src/pos/service';
import {Actor} from '../src/pos/auth';
async function main(){
 const db=new URL(process.env.POS_TEST_DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(db.hostname)||db.port!=='55439'||!db.pathname.includes('pos_test')||process.env.DATABASE_URL!==process.env.POS_TEST_DATABASE_URL)throw Error('Isolated POS database required');
 const suffix=randomUUID().slice(0,8);
 const user=await prisma.user.create({data:{email:`${suffix}@store-browser.test.invalid`,password:await bcrypt.hash('BrowserAdminPassword!',4),role:'SUPER_ADMIN'}});
 const stores=[];
 for(const tag of ['A','B'])stores.push(await prisma.store.create({data:{name:`Browser POS ${tag} ${suffix}`,code:`UI-${tag}-${suffix}`,posCredential:{create:await defaultPOSCredential()}}}));
 const a=stores[0]!;
 const actor:Actor={userId:user.id,role:user.role,admin:true,permissions:{}};
 const product=await service.createProduct(actor,{name:`Browser Shirt ${suffix}`,code:`UI-${suffix}`,variants:[{sku:`UI-${suffix}`,size:'M',color:'Black',sellingPrice:'100',costPrice:'50',taxRate:'5'}]});
 await service.adjust(actor,{storeId:a.id,variantId:product.variants[0]!.id,quantityDelta:5,type:'OPENING',reason:'Isolated browser fixture'});
 const register=await prisma.pOSRegister.create({data:{storeId:a.id,name:'Browser terminal'}});
 const app=express();app.use(express.json());app.use('/api/v1/pos',posRoutes);app.use('/api/admin',adminRoutes);app.use('/api/auth',authRoutes);
 const server=app.listen(0,'127.0.0.1',()=>console.log('STORE_AUTH_READY '+JSON.stringify({origin:`http://127.0.0.1:${(server.address() as {port:number}).port}`,user:{id:user.id,name:'Browser Super Admin',email:user.email,role:user.role},stores,productName:product.name,registerId:register.id})));
 process.on('SIGTERM',()=>server.close(async()=>{await prisma.$disconnect();process.exit(0);}));
}
main().catch(async()=>{console.error('Store browser harness failed');await prisma.$disconnect();process.exit(1);});
