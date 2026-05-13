export type XteaKey = readonly [number, number, number, number];

const XTEA_DELTA = 0x9e3779b9;
const XTEA_ROUNDS = 32;

function toUint32(value: number): number {
  return value >>> 0;
}

export function isEmptyXteaKey(key: readonly number[]): boolean {
  return key.length === 4 && key.every((value) => value === 0);
}

export function decryptXtea(buffer: Buffer, key: XteaKey, start = 0, end = buffer.length): Buffer {
  if (isEmptyXteaKey(key)) {
    return Buffer.from(buffer);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > buffer.length) {
    throw new RangeError(`Invalid XTEA decrypt range ${start}-${end} for ${buffer.length} byte buffer.`);
  }

  const output = Buffer.from(buffer);
  const blockEnd = start + Math.floor((end - start) / 8) * 8;
  for (let offset = start; offset < blockEnd; offset += 8) {
    let v0 = output.readUInt32BE(offset);
    let v1 = output.readUInt32BE(offset + 4);
    let sum = toUint32(XTEA_DELTA * XTEA_ROUNDS);

    for (let round = 0; round < XTEA_ROUNDS; round += 1) {
      v1 = toUint32(v1 - toUint32(toUint32(((v0 << 4) ^ (v0 >>> 5)) + v0) ^ toUint32(sum + key[(sum >>> 11) & 3])));
      sum = toUint32(sum - XTEA_DELTA);
      v0 = toUint32(v0 - toUint32(toUint32(((v1 << 4) ^ (v1 >>> 5)) + v1) ^ toUint32(sum + key[sum & 3])));
    }

    output.writeUInt32BE(v0, offset);
    output.writeUInt32BE(v1, offset + 4);
  }

  return output;
}

export function encryptXtea(buffer: Buffer, key: XteaKey, start = 0, end = buffer.length): Buffer {
  if (isEmptyXteaKey(key)) {
    return Buffer.from(buffer);
  }

  const output = Buffer.from(buffer);
  const blockEnd = start + Math.floor((end - start) / 8) * 8;
  for (let offset = start; offset < blockEnd; offset += 8) {
    let v0 = output.readUInt32BE(offset);
    let v1 = output.readUInt32BE(offset + 4);
    let sum = 0;

    for (let round = 0; round < XTEA_ROUNDS; round += 1) {
      v0 = toUint32(v0 + toUint32(toUint32(((v1 << 4) ^ (v1 >>> 5)) + v1) ^ toUint32(sum + key[sum & 3])));
      sum = toUint32(sum + XTEA_DELTA);
      v1 = toUint32(v1 + toUint32(toUint32(((v0 << 4) ^ (v0 >>> 5)) + v0) ^ toUint32(sum + key[(sum >>> 11) & 3])));
    }

    output.writeUInt32BE(v0, offset);
    output.writeUInt32BE(v1, offset + 4);
  }

  return output;
}
