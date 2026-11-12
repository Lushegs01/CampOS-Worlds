// Exact smaller copies of Basis (BasisLZ/ETC1S) KTX2 textures and of GLB files that embed them, by dropping the
// largest mip levels. Nothing is re-encoded: the remaining levels, their global codebooks and every other byte are
// copied as they are, so a 1024² texture becomes the very same texture's 512² mip chain (about a third of the bytes).
// Used by scripts/assets/build-arena-mobile.mjs for the arena's phone tier.

const align = (n, a) => Math.ceil(n / a) * a;

/** Drop the largest mip levels of a BasisLZ KTX2 until it is at most `maxSize` pixels wide and high. */
export function dropTopMips(input, maxSize = 512) {
  const src = Buffer.from(input.buffer, input.byteOffset, input.byteLength), dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (src.toString('latin1', 1, 7) !== 'KTX 20') throw new Error('not a KTX2 file');
  const width = dv.getUint32(20, true), height = dv.getUint32(24, true), depth = dv.getUint32(28, true), layers = dv.getUint32(32, true), faces = dv.getUint32(36, true);
  const levels = dv.getUint32(40, true), scheme = dv.getUint32(44, true);
  let drop = 0; while (drop < levels - 1 && Math.max(width >> drop, height >> drop) > maxSize) drop++;
  if (!drop) return src;
  if (scheme !== 1) throw new Error(`only BasisLZ (ETC1S) supercompression is supported, not scheme ${scheme}`);
  if (depth > 1 || layers > 1 || faces !== 1) throw new Error('only plain 2D textures are supported');
  const dfdOff = dv.getUint32(48, true), dfdLen = dv.getUint32(52, true), kvdOff = dv.getUint32(56, true), kvdLen = dv.getUint32(60, true);
  const sgdOff = Number(dv.getBigUint64(64, true)), sgdLen = Number(dv.getBigUint64(72, true));
  const index = Array.from({ length: levels }, (_, i) => ({ off: Number(dv.getBigUint64(80 + i * 24, true)), len: Number(dv.getBigUint64(88 + i * 24, true)), raw: Number(dv.getBigUint64(96 + i * 24, true)) }));
  const keep = index.slice(drop), n = keep.length;
  // Supercompression global data: a 20-byte header, one 20-byte image descriptor per level (largest first), then
  // the shared endpoint/selector codebooks and tables. Remove the dropped levels' descriptors.
  const sgd = src.subarray(sgdOff, sgdOff + sgdLen);
  const newSgd = Buffer.concat([sgd.subarray(0, 20), sgd.subarray(20 + drop * 20, 20 + levels * 20), sgd.subarray(20 + levels * 20)]);
  const newDfdOff = 80 + n * 24, newKvdOff = newDfdOff + dfdLen, newSgdOff = kvdLen ? align(newKvdOff + kvdLen, 8) : align(newDfdOff + dfdLen, 8);
  let cursor = newSgdOff + newSgd.length;
  // Level data is stored smallest first; keep that order.
  const order = keep.map((l, i) => ({ ...l, i })).sort((a, b) => a.off - b.off), placed = new Array(n);
  for (const l of order) { placed[l.i] = cursor; cursor += l.len; }
  const out = Buffer.alloc(cursor), ov = new DataView(out.buffer, out.byteOffset, out.byteLength);
  src.copy(out, 0, 0, 48);
  ov.setUint32(20, Math.max(1, width >> drop), true); ov.setUint32(24, height ? Math.max(1, height >> drop) : 0, true); ov.setUint32(40, n, true);
  ov.setUint32(48, newDfdOff, true); ov.setUint32(52, dfdLen, true); ov.setUint32(56, kvdLen ? newKvdOff : 0, true); ov.setUint32(60, kvdLen, true);
  ov.setBigUint64(64, BigInt(newSgdOff), true); ov.setBigUint64(72, BigInt(newSgd.length), true);
  keep.forEach((l, i) => { ov.setBigUint64(80 + i * 24, BigInt(placed[i]), true); ov.setBigUint64(88 + i * 24, BigInt(l.len), true); ov.setBigUint64(96 + i * 24, BigInt(l.raw), true); });
  src.copy(out, newDfdOff, dfdOff, dfdOff + dfdLen);
  if (kvdLen) src.copy(out, newKvdOff, kvdOff, kvdOff + kvdLen);
  newSgd.copy(out, newSgdOff);
  keep.forEach((l, i) => src.copy(out, placed[i], l.off, l.off + l.len));
  return out;
}

/** Width of a KTX2 file. */
export const ktx2Width = buf => new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(20, true);

/**
 * A GLB whose embedded KTX2 images are replaced by `dropTopMips` copies. The binary chunk is rebuilt region by
 * region (plain buffer views and EXT_meshopt_compression streams), so compressed geometry is copied byte for byte.
 */
export function shrinkGlb(input, maxSize = 512) {
  const src = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (src.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLen = src.readUInt32LE(12), json = JSON.parse(src.toString('utf8', 20, 20 + jsonLen).replace(/\0+$/, '').trimEnd());
  const binStart = 20 + jsonLen + 8, binLen = src.readUInt32LE(20 + jsonLen), bin = src.subarray(binStart, binStart + binLen);
  const views = json.bufferViews ?? [];
  const images = new Set((json.images ?? []).filter(i => i.mimeType === 'image/ktx2' && i.bufferView != null).map(i => i.bufferView));
  // Every region of buffer 0 (the GLB's binary chunk) that something points at.
  const regions = [];
  views.forEach((v, i) => { if ((v.buffer ?? 0) === 0 && json.buffers?.[0]?.uri == null) regions.push({ owner: v, key: 'view', i, off: v.byteOffset ?? 0, len: v.byteLength }); const m = v.extensions?.EXT_meshopt_compression; if (m && (m.buffer ?? 0) === 0) regions.push({ owner: m, key: 'meshopt', i, off: m.byteOffset ?? 0, len: m.byteLength }); });
  regions.sort((a, b) => a.off - b.off);
  const parts = []; let cursor = 0, changed = false;
  const seen = new Map();
  for (const r of regions) {
    const k = `${r.off}:${r.len}`;
    if (seen.has(k)) { const at = seen.get(k); r.owner.byteOffset = at.off; r.owner.byteLength = at.len; continue; }
    let bytes = bin.subarray(r.off, r.off + r.len);
    if (r.key === 'view' && images.has(r.i)) { const smaller = dropTopMips(bytes, maxSize); if (smaller !== bytes && smaller.length < bytes.length) { bytes = smaller; changed = true; } }
    const pad = align(cursor, 4) - cursor; if (pad) { parts.push(Buffer.alloc(pad)); cursor += pad; }
    r.owner.byteOffset = cursor; r.owner.byteLength = bytes.length; seen.set(k, { off: cursor, len: bytes.length });
    parts.push(bytes); cursor += bytes.length;
  }
  if (!changed) return src;
  const pad = align(cursor, 4) - cursor; if (pad) { parts.push(Buffer.alloc(pad)); cursor += pad; }
  json.buffers[0].byteLength = cursor;
  let text = Buffer.from(JSON.stringify(json), 'utf8'); text = Buffer.concat([text, Buffer.alloc(align(text.length, 4) - text.length, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + text.length + 8 + cursor, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(text.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(cursor, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, text, bh, ...parts]);
}
