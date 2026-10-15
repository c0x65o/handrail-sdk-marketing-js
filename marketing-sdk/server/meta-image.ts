import sharp from "sharp";
import { byteDigest, requireThat } from "./store.js";
import { inspectMedia } from "./generation.js";

export interface MetaImageSource { bytes: Uint8Array; mime: string; filename: string }
/** One provider encoding path. PNG/JPEG bytes are preserved; WebP follows the
 * original white-background, quality-90 mozjpeg recipe. No network or writes. */
export async function prepareMetaImageUpload(source: MetaImageSource) {
  const bytes=Buffer.from(source.bytes);
  requireThat(["image/jpeg","image/png","image/webp"].includes(source.mime),"invalid_asset",422);
  await inspectMedia(bytes,"image",source.mime);
  const transcoded=source.mime==="image/webp";
  const output=transcoded ? await sharp(bytes).flatten({background:"#ffffff"}).jpeg({quality:90,mozjpeg:true}).toBuffer() : bytes;
  const mime=transcoded?"image/jpeg":source.mime;
  const decoded=await inspectMedia(output,"image",mime);
  const name=source.filename.trim().slice(0,255)||"handrail-creative";
  const filename=transcoded?`${name.replace(/\.[^.]+$/,"")}.jpg`:name;
  return {bytes:output,filename,mime,transcoded,width:decoded.width,height:decoded.height,
    sourceDigest:byteDigest(bytes),uploadDigest:byteDigest(output),
    uploadReceipt:{content_sha256:byteDigest(output),content_hash_encoding:"sha256_bytes" as const,
      filename:`handrail-${byteDigest(output)}.${mime==="image/png"?"png":"jpg"}`,byte_size:output.length,media_type:mime}};
}
/** Re-encoding is only a recovery candidate. Equality to the immutable upload
 * receipt digest proves the bytes; codec drift/missing receipts are not success. */
export async function recoverMetaImageUpload(source: MetaImageSource, expectedSourceDigest: string, expectedUploadDigest: string) {
  requireThat(/^[a-f0-9]{64}$/.test(expectedSourceDigest)&&/^[a-f0-9]{64}$/.test(expectedUploadDigest),"meta_upload_digest_required");
  requireThat(byteDigest(source.bytes)===expectedSourceDigest,"meta_upload_source_changed");
  const result=await prepareMetaImageUpload(source);
  requireThat(result.uploadDigest===expectedUploadDigest,"meta_original_upload_bytes_unverified");
  return result;
}
