// Worker: resize with sharp, then Basis/ETC1S-encode to KTX2 with mipmaps.
import { parentPort } from 'node:worker_threads';
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

console.log = () => {}; // the Basis WASM is chatty
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

parentPort.on('message', async (job) => {
  try {
    let img = job.raw ? sharp(Buffer.from(job.raw.data), { raw: { width: job.raw.width, height: job.raw.height, channels: 4 } }) : sharp(job.in);
    if (job.size) img = img.resize(job.size, job.sizeY || job.size, { fit: 'fill', kernel: 'lanczos3' });
    const png = await img.png().toBuffer();
    const color = job.kind === 'color';
    const out = await encodeToKTX2(new Uint8Array(png), {
      isUASTC: false,
      qualityLevel: job.quality ?? (job.kind === 'normal' ? 230 : 180),
      compressionLevel: 2,
      isNormalMap: job.kind === 'normal',
      isPerceptual: color,
      isSetKTX2SRGBTransferFunc: color,
      isYFlip: !!job.flipY,
      generateMipmap: true,
      isKTX2File: true,
      imageDecoder,
    });
    fs.mkdirSync(path.dirname(job.out), { recursive: true });
    fs.writeFileSync(job.out, out);
    parentPort.postMessage({ ok: job.out });
  } catch (error) {
    parentPort.postMessage({ error: `${job.out}: ${error?.stack || error}` });
  }
});
