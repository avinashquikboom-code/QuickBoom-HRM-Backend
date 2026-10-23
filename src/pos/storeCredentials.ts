import bcrypt from 'bcryptjs';
import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/db';
import { authenticate, POSRequest } from './auth';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { Request, Response, NextFunction } from 'express';
import { ensure, integer, keys, object, POSError } from './validation';

// Initial bootstrap credential only; never send this value in an API response.
const INITIAL_POS_PASSWORD = '123456';
export const defaultPOSCredential = async () => ({passwordHash: await bcrypt.hash(INITIAL_POS_PASSWORD, 10), posEnabled: true});

// Opaque server-keyed version, not a password verifier. Fresh bcrypt salts make
// every password change/reset revoke prior store tokens without a schema change.
export function credentialVersion(passwordHash: string) {
  return createHmac('sha256', process.env.JWT_SECRET || 'local-pos-credential-version').update(passwordHash).digest('hex');
}
export async function initializeStorePOSCredentials(dryRun = false) {
  let cursor = 0, missing = 0, initialized = 0;
  while (true) {
    const stores = await prisma.store.findMany({where:{isActive:true,id:{gt:cursor},posCredential:{is:null}},select:{id:true},orderBy:{id:'asc'},take:100});
    if (!stores.length) break;
    for (const store of stores) {
      cursor=store.id;missing++;
      if (dryRun) continue;
      const data=await defaultPOSCredential();
      // skipDuplicates is an atomic INSERT ... ON CONFLICT DO NOTHING. It
      // preserves a custom credential created concurrently with initialization.
      const result=await prisma.pOSStoreCredential.createMany({data:[{storeId:store.id,...data}],skipDuplicates:true});
      initialized+=result.count;
    }
  }
  return {missing,initialized,dryRun};
}

export function requireStorePOSAdmin(req:Request,res:Response,next:NextFunction) {
  authenticate(req,res,(error?:unknown)=>{
    if(error){res.status(error instanceof POSError?error.status:500).json({success:false,message:error instanceof POSError?error.message:'Unable to authorize credential management.'});return;}
    const actor=(req as POSRequest).actor;
    if(actor.role!=='SUPER_ADMIN'||actor.isPosStoreSession){res.status(403).json({success:false,message:'Super Admin access is required to manage store POS credentials.'});return;}
    (req as AuthenticatedRequest).user={id:actor.userId,role:actor.role};next();
  });
}

export async function manageStorePOSCredential(req:AuthenticatedRequest, rawId:unknown, raw:unknown, mode:'password'|'reset'|'access') {
  ensure(req.user?.role==='SUPER_ADMIN','Super Admin access required',403);
  const storeId=integer(Number(rawId),'storeId');const b=object(raw);
  keys(b,mode==='password'?['password','posEnabled']:mode==='access'?['posEnabled']:[]);
  if(b.posEnabled!==undefined)ensure(typeof b.posEnabled==='boolean','posEnabled must be a boolean');
  if(mode==='access')ensure(typeof b.posEnabled==='boolean','posEnabled must be a boolean');
  let passwordHash:string|undefined;
  if(mode==='password') {
    ensure(typeof b.password==='string'&&b.password.length>=6&&Buffer.byteLength(b.password,'utf8')<=72,'Password must contain at least 6 characters and at most 72 UTF-8 bytes.');
    passwordHash=await bcrypt.hash(b.password,10);
  } else if(mode==='reset') passwordHash=(await defaultPOSCredential()).passwordHash;
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${storeId}::bigint)::text`;
    const store=await tx.store.findUnique({where:{id:storeId},select:{id:true,name:true}});ensure(store,'Store not found',404);
    const existing=await tx.pOSStoreCredential.findUnique({where:{storeId},select:{id:true,posEnabled:true}});
    const createdHash=passwordHash??(!existing?(await defaultPOSCredential()).passwordHash:undefined);
    const credential=await tx.pOSStoreCredential.upsert({where:{storeId},
      create:{storeId,passwordHash:createdHash!,posEnabled:b.posEnabled??true},
      update:{...(passwordHash?{passwordHash,failedAttempts:0,lockedUntil:null}:{}),...(b.posEnabled!==undefined?{posEnabled:b.posEnabled}:{})},
      select:{storeId:true,posEnabled:true,updatedAt:true,lastLoginAt:true},
    });
    await tx.activityLog.create({data:{actorId:String(req.user!.id),actorRole:'SUPER_ADMIN',actorName:req.user!.email||'Super Admin',source:'ADMIN_PANEL',action:mode==='reset'?'RESET_STORE_POS_PASSWORD':mode==='password'?'SET_STORE_POS_CREDENTIALS':'UPDATE_STORE_POS_ACCESS',entityType:'Store',entityId:String(storeId),description:`${mode==='reset'?'Reset POS password':mode==='password'?'Changed POS password':'Changed POS access'} for store ${store.name}`}});
    return credential;
  },{timeout:15000});
}

export async function authenticateStorePassword(storeId:number,password:string) {
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${storeId}::bigint)::text`;
    const store=await tx.store.findUnique({where:{id:storeId},include:{posCredential:true}});
    if(!store)return {error:new POSError(401,'Store not found or invalid credentials.')};
    if(!store.isActive||!store.posCredential?.posEnabled)return {error:new POSError(403,'This store is inactive or POS access is disabled. Contact a Super Admin.')};
    const cred=store.posCredential;
    if(cred.lockedUntil&&cred.lockedUntil>new Date())return {error:new POSError(429,'Too many failed attempts. Try again after 15 minutes or contact a Super Admin.')};
    const correct=await bcrypt.compare(password,cred.passwordHash);
    if(!correct){
      const failed=cred.lockedUntil&&cred.lockedUntil<=new Date()?1:cred.failedAttempts+1;
      await tx.pOSStoreCredential.update({where:{storeId},data:{failedAttempts:failed,lockedUntil:failed>=5?new Date(Date.now()+15*60*1000):null}});
      return {error:new POSError(failed>=5?429:401,failed>=5?'Too many failed attempts. POS access locked for 15 minutes.':'Invalid store password.')};
    }
    await tx.pOSStoreCredential.update({where:{storeId},data:{failedAttempts:0,lockedUntil:null,lastLoginAt:new Date()}});
    const email=`pos-store-${store.id}@hopkid.local`;
    // A terminal's HRM user is an audit/FK identity, not an HRM login credential.
    const user=await tx.user.upsert({where:{email},update:{password:await bcrypt.hash(randomBytes(32).toString('hex'),10)},create:{email,password:await bcrypt.hash(randomBytes(32).toString('hex'),10),role:'SALESMAN',isActive:true},select:{id:true,isActive:true}});
    if(!user.isActive)return {error:new POSError(403,'The POS terminal account is disabled. Contact a Super Admin.')};
    return {store:{id:store.id,name:store.name,code:store.code},userId:user.id,version:credentialVersion(cred.passwordHash)};
  },{timeout:15000});
}
