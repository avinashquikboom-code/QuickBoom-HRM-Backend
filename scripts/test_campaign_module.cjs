// Real Express/Prisma/Sharp workflow against an explicitly selected disposable DB.
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || '');
assert(['localhost','127.0.0.1'].includes(url.hostname) && url.port === '55439' && url.pathname.includes('campaign_test'), 'Disposable campaign_test database required');
process.env.JWT_SECRET = 'isolated-campaign-fixture-only';
process.env.PUBLIC_API_URL = '';
require.cache[require.resolve('../src/services/campaignS3Service')] = { exports: { campaignS3: async () => null } };
const express = require('express');
const sharp = require('sharp');
const { prisma } = require('../src/utils/db');
const { signAccessToken } = require('../src/utils/jwt');
const router = require('../src/routes/campaignRoutes').default;
const uploads = require('../src/routes/uploadRoutes').default;
const { campaignService } = require('../src/services/campaignService');
const { firebaseNotificationService } = require('../src/services/firebaseNotificationService');
let server, directory, originalCwd = process.cwd(), checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  const key = randomUUID();
  await prisma.workMode.upsert({ where: { id:'OFFICE' }, create:{ id:'OFFICE', name:'Office' }, update:{} });
  const office = await prisma.office.create({ data:{ name:'Campaign fixture '+key, address:'Fixture', latitude:0, longitude:0 } });
  const otherOffice = await prisma.office.create({ data:{ name:'Other fixture '+key, address:'Fixture', latitude:0, longitude:0 } });
  const actor = async (code, officeId, role='HR', active=true) => {
    const user = await prisma.user.create({data:{email:`${code}-${key}@test.invalid`,password:'unused',role,isActive:active}});
    const employee = await prisma.employee.create({data:{userId:user.id,employeeCode:`${code}-${key}`,firstName:code,lastName:'Fixture',officeId,status:'active',source:'HOPKID'}});
    return {user,employee,token:signAccessToken({id:user.id,email:user.email,role})};
  };
  const admin = await actor('admin',office.id);
  const other = await actor('other',otherOffice.id);
  const employee = await actor('with-token',office.id,'EMPLOYEE');
  const noToken = await actor('no-token',office.id,'EMPLOYEE');
  const inactive = await actor('inactive-user',office.id,'EMPLOYEE',false);
  await prisma.employee.create({data:{employeeCode:`no-user-${key}`,firstName:'No user',lastName:'Fixture',officeId:office.id,status:'active',source:'HOPKID'}});
  await prisma.employee.create({data:{employeeCode:`inactive-${key}`,firstName:'Inactive',lastName:'Fixture',officeId:office.id,status:'inactive',source:'HOPKID'}});
  await prisma.fCMToken.createMany({data:[{userId:employee.user.id,token:`fixture-token-one-${key}`},{userId:employee.user.id,token:`fixture-token-two-${key}`},{userId:noToken.user.id,token:`inactive-token-${key}`,isActive:false},{userId:inactive.user.id,token:`excluded-token-${key}`}]});
  await prisma.device.create({data:{userId:employee.user.id,fcmToken:`fixture-token-one-${key}`,platform:'android'}});
  directory = await fs.mkdtemp(path.join(os.tmpdir(),'campaign-module-')); process.chdir(directory);
  const app=express();app.use(express.json({limit:'10mb'}));
  app.use('/api/uploads',express.static(path.join(directory,'uploads')),uploads);
  app.use('/uploads',express.static(path.join(directory,'uploads')),uploads);
  app.use('/api/v1/admin/campaigns',router);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`, base=origin+'/api/v1/admin/campaigns';
  const request=async(suffix,body,token=admin.token,method=body===undefined?'GET':'POST')=>{
    const response=await fetch(base+suffix,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body!==undefined && !(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
    return {response,body:await response.json()};
  };
  await test('authentication and role checks remain active',async()=>{
    assert.equal((await request('/recipients/preview',undefined,'')).response.status,401);
    assert.equal((await request('/recipients/preview',undefined,employee.token)).response.status,403);
  });
  let imageUrl, id;
  const image=await sharp({create:{width:100,height:80,channels:3,background:'#345678'}}).png().toBuffer();
  await test('multipart image upload returns an actual retrievable optimized image and avoids duplicates',async()=>{
    const form=new FormData();form.append('image',new Blob([image],{type:'image/png'}),'banner.png');
    const result=await request('/upload-image',form);assert.equal(result.response.status,201,JSON.stringify(result.body));imageUrl=result.body.data.imageUrl;
    assert(imageUrl.startsWith('/api/uploads/campaigns/'));const response=await fetch(origin+imageUrl);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/jpeg/);
    const again=new FormData();again.append('file',new Blob([image],{type:'image/png'}),'same.png');
    assert.equal((await request('/upload-image',again)).body.data.imageUrl,imageUrl);
    assert.equal((await fs.readdir(path.join(directory,'uploads','campaigns'))).length,3);
  });
  await test('upload validates missing files, content, base64 and size with 400/413',async()=>{
    assert.equal((await request('/upload-image',new FormData())).response.status,400);
    assert.equal((await request('/upload-image',{imageBase64:123})).response.status,400);
    const invalid=new FormData();invalid.append('image',new Blob(['invalid'],{type:'image/png'}),'bad.png');assert.equal((await request('/upload-image',invalid)).response.status,400);
    const huge=new FormData();huge.append('image',new Blob([Buffer.alloc(5*1024*1024+1)],{type:'image/png'}),'huge.png');assert.equal((await request('/upload-image',huge)).response.status,413);
    assert.equal((await request('/upload-image',{imageBase64:image.toString('base64'),mimeType:'image/png'})).response.status,201);
  });
  const campaign={title:'Fixture campaign',message:'Fixture message',audienceType:'ALL_EMPLOYEES',status:'DRAFT',imageUrl};
  await test('create/detail/update preserve the persisted ID, image, optional-image contract and API shape',async()=>{
    const created=await request('',campaign);assert.equal(created.response.status,201,JSON.stringify(created.body));id=created.body.data.id;assert(id && id!=='undefined');
    assert.equal((await request('/'+id)).body.data.id,id);
    const updated=await request('/'+id,{...campaign,title:'Updated',imageUrl:null},admin.token,'PATCH');assert.equal(updated.response.status,200,JSON.stringify(updated.body));assert.equal(updated.body.data.imageUrl,null);
    assert.equal((await request('/'+id)).body.data.title,'Updated');
    assert.equal((await request('',{...campaign,imageUrl:null})).response.status,201);
  });
  await test('legacy missing image records render safely without fabricated image URLs',async()=>{
    await prisma.campaign.update({where:{id},data:{imageUrl:'api/uploads/campaigns/campaign_missing.png'}});
    const legacy=await request('/'+id);assert.equal(legacy.response.status,200);assert.equal(legacy.body.data.imageUrl,null);assert.equal(legacy.body.data.imageMissing,true);
    assert.equal((await request('/'+id,{...campaign,imageUrl:null},admin.token,'PATCH')).response.status,200);
  });
  await test('ALL_EMPLOYEES counts match the database, count employees once and retain in-app-only employees',async()=>{
    const result=await request('/recipients/preview?audienceType=ALL_EMPLOYEES');assert.equal(result.response.status,200,JSON.stringify(result.body));
    const rows=await prisma.employee.findMany({where:{officeId:office.id,status:{in:['active','ACTIVE']},OR:[{userId:null},{user:{isActive:true}}]},include:{user:{include:{fcmTokens:true,devices:true}}}});
    const reachable=rows.filter(row=>row.user && (row.user.fcmTokens.some(t=>t.isActive && t.token.trim()) || row.user.devices.some(t=>t.fcmToken.trim()))).length;
    assert.equal(result.body.data.totalCount,rows.length);assert.equal(result.body.data.reachableByPush,reachable);assert.equal(reachable,1);
    assert(result.body.data.preview.some(row=>row.employeeCode===`no-user-${key}`));
    const empty=await request('/recipients/preview?audienceType=EMPLOYEES&employeeIds=2147483647');assert.equal(empty.body.data.totalCount,0);
    for(const query of ['audienceType=INVALID','roles=INVALID','employeeIds=1oops','timezone=Invalid/Zone']) assert.equal((await request('/recipients/preview?'+query)).response.status,400,query);
  });
  await test('foreign office campaigns stay inaccessible for detail, update, send, schedule, cancel, delete and lists',async()=>{
    const foreign=await request('',{...campaign,imageUrl:null},other.token);const foreignId=foreign.body.data.id;
    for(const [suffix,method,body] of [['/'+foreignId,'GET',undefined],['/'+foreignId,'PATCH',campaign],['/'+foreignId+'/send','POST',{}],['/'+foreignId+'/schedule','POST',{scheduledAt:new Date(Date.now()+60000).toISOString()}],['/'+foreignId+'/cancel','POST',{}],['/'+foreignId,'DELETE',undefined],['/'+foreignId+'/analytics','GET',undefined]]) assert.equal((await request(suffix,body,admin.token,method)).response.status,404,suffix+' '+method);
    assert(!(await request('')).body.data.campaigns.some(row=>row.id===foreignId));
    assert.equal((await request('/'+randomUUID())).response.status,404);
    assert.equal((await request('/undefined')).response.status,400);
  });
  await test('image/storage failures are safe and missing schema is actionable; no raw internals reach clients',async()=>{
    const save=campaignService.saveUploadedImage;
    try {
      campaignService.saveUploadedImage=async()=>{throw new Error('/private/secret/internal-path');};
      const failed=await request('/upload-image',{imageBase64:image.toString('base64')});assert.equal(failed.response.status,500);assert(!JSON.stringify(failed.body).includes('/private/secret'));
      campaignService.saveUploadedImage=async()=>{throw Object.assign(new Error('missing table'),{code:'P2021',meta:{table:'CampaignImageAsset'}});};
      assert.equal((await request('/upload-image',{imageBase64:image.toString('base64')})).response.status,503);
    } finally {campaignService.saveUploadedImage=save;}
    assert.equal((await fetch(origin+'/api/uploads/campaigns/campaign_missing.png')).status,404);
    const missing=await request('',{...campaign,imageUrl:'/api/uploads/campaigns/campaign_missing.png'});assert.equal(missing.response.status,400);
  });
  await test('scheduled and dispatched campaigns retain existing workflow without duplicate retry delivery',async()=>{
    const send=firebaseNotificationService.sendNotificationToTokens;let calls=0;
    firebaseNotificationService.sendNotificationToTokens=async tokens=>{calls++;return {successCount:tokens.length,failureCount:0,responses:tokens.map(()=>({success:true,messageId:'fixture-message'}))};};
    try {
      assert.equal((await request('/'+id+'/send',{})).response.status,200);
      assert.equal((await request('/'+id+'/send',{})).response.status,409);assert.equal(calls,1);
      const draft=await request('',{...campaign,imageUrl:null});const schedule=await request('/'+draft.body.data.id+'/schedule',{scheduledAt:new Date(Date.now()+60000).toISOString()});assert.equal(schedule.body.data.status,'SCHEDULED');
      assert.equal((await request('/'+draft.body.data.id,undefined,admin.token,'DELETE')).response.status,200);
    } finally {firebaseNotificationService.sendNotificationToTokens=send;}
  });
  console.log(`Campaign module: ${checks} end-to-end groups passed`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(server) await new Promise(resolve=>server.close(resolve));
  process.chdir(originalCwd);if(directory) await fs.rm(directory,{recursive:true,force:true});await prisma.$disconnect();process.exit(process.exitCode||0);
});
