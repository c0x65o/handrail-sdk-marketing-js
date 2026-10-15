import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {prepareMetaImageUpload,recoverMetaImageUpload} from '../server/meta-image.js';
import {byteDigest} from '../server/store.js';

test('Meta upload preserves JPEG/PNG and recovers only exact historical WebP transcode bytes',async()=>{
  const source=await sharp({create:{width:40,height:50,channels:4,background:'#ddd8cc80'}}).webp().toBuffer();
  const historical=await sharp(source).flatten({background:'#ffffff'}).jpeg({quality:90,mozjpeg:true}).toBuffer();
  const r=await recoverMetaImageUpload({bytes:source,mime:'image/webp',filename:'original.webp'},byteDigest(source),byteDigest(historical));
  assert.deepEqual(r.bytes,historical);assert.equal(r.mime,'image/jpeg');assert.equal(r.filename,'original.jpg');assert.equal(r.transcoded,true);
  assert.equal(r.sourceDigest,byteDigest(source));assert.equal(r.uploadDigest,byteDigest(historical));assert.equal(r.width,40);assert.equal(r.height,50);
  for(const mime of ['image/png','image/jpeg']){
    const bytes=mime==='image/png'?await sharp(source).png().toBuffer():historical;
    const p=await prepareMetaImageUpload({bytes,mime,filename:'retained'});assert.deepEqual(p.bytes,bytes);assert.equal(p.transcoded,false);
    assert.equal(p.sourceDigest,p.uploadDigest);
  }
  await assert.rejects(recoverMetaImageUpload({bytes:source,mime:'image/webp',filename:'original.webp'},byteDigest(source),'0'.repeat(64)),/meta_original_upload_bytes_unverified/);
  await assert.rejects(recoverMetaImageUpload({bytes:source,mime:'image/webp',filename:'original.webp'},'0'.repeat(64),byteDigest(historical)),/meta_upload_source_changed/);
  await assert.rejects(recoverMetaImageUpload({bytes:source,mime:'image/webp',filename:'original.webp'},byteDigest(source),''),/meta_upload_digest_required/);
  await assert.rejects(prepareMetaImageUpload({bytes:source,mime:'image/png',filename:'mislabelled.png'}),/media_mime_mismatch/);
  await assert.rejects(prepareMetaImageUpload({bytes:Buffer.from('invalid'),mime:'image/jpeg',filename:'invalid.jpg'}));
});
