import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { crc32 } from "node:zlib";
import { inspectMedia, DomainError } from "../server/index.js";

const image = () => sharp({ create: { width: 32, height: 24, channels: 3, background: "#5588aa" } });
test("media accepts decoded PNG, JPEG and both WebP encodings with exact byte-view boundaries", async () => {
  for (const [format, bytes] of [
    ["png", await image().png().toBuffer()],
    ["jpeg", await image().jpeg().toBuffer()],
    ["webp", await image().webp().toBuffer()],
    ["webp", await image().webp({ lossless: true }).toBuffer()],
  ] as const) {
    const envelope = Buffer.concat([Buffer.from("private-prefix"), bytes, Buffer.from("private-suffix")]);
    const view = new Uint8Array(envelope.buffer, envelope.byteOffset + 14, bytes.length);
    assert.deepEqual(await inspectMedia(view, "image", `image/${format}`), { mime: `image/${format}`, width: 32, height: 24 });
    await assert.rejects(inspectMedia(view, "image", "image/gif"), /media_mime_mismatch/);
  }
});

test("media rejects irrelevant decoders, false signatures, malformed and truncated images with safe errors", async () => {
  const png = await image().png().toBuffer(), jpeg = await image().jpeg().toBuffer();
  const webp = await image().webp().toBuffer();
  const highBitRiff = Buffer.from(webp); highBitRiff[0] = highBitRiff[0]! | 0x80;
  const wrongSize = Buffer.from(webp); wrongSize.writeUInt32LE(0, 4);
  for (const bytes of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><text>private-input</text></svg>'),
    await image().tiff().toBuffer(), await image().gif().toBuffer(), await image().avif().toBuffer(),
    Buffer.alloc(0), Buffer.from("private-input"), Buffer.from([0xff, 0xd8, 0xff]),
    png.subarray(0, 40), jpeg.subarray(0, jpeg.length - 30),
    Buffer.concat([png.subarray(0, 8), Buffer.from("private-input")]),
    highBitRiff, wrongSize,
  ]) {
    await assert.rejects(inspectMedia(bytes, "image"), error => {
      assert.ok(error instanceof DomainError);
      assert.match(error.code, /^(invalid_image_bytes|invalid_media)$/);
      assert.equal(error.status, 422);
      assert.ok(!JSON.stringify(error).includes("private-input"));
      return true;
    });
  }
});

test("media enforces byte, dimension and decoded pixel bounds", async () => {
  await assert.rejects(inspectMedia(new Uint8Array(100 * 1024 * 1024), "image"), /invalid_media/);
  const tooWide = await sharp({ create: { width: 16_385, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(inspectMedia(tooWide, "image"), /invalid_image_bytes/);
  // Valid PNG signature/IHDR checksum advertising a decompression bomb, no large allocation.
  const bomb = await image().png().toBuffer();
  bomb.writeUInt32BE(10_000, 16); bomb.writeUInt32BE(10_000, 20);
  bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
  await assert.rejects(inspectMedia(bomb, "image"), /invalid_image_bytes/);
});
