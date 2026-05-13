import zlib from "zlib";
import { CacheInputStream } from "./cache-input-stream";
import { decryptXtea, isEmptyXteaKey, XteaKey } from "./xtea";

const Bunzip = require("seek-bzip") as {
  decode(input: Buffer, expectedSize?: number): Buffer;
};

export type CacheContainerCompression = "none" | "bzip2" | "gzip";

export type CacheContainer = {
  compression: CacheContainerCompression;
  compressedSize: number;
  decompressedSize: number;
  data: Buffer;
};

const COMPRESSION_BY_ID: Record<number, CacheContainerCompression> = {
  0: "none",
  1: "bzip2",
  2: "gzip",
};

export function decompressCacheContainer(rawContainer: Buffer, xteaKey?: XteaKey): CacheContainer {
  const container =
    xteaKey && !isEmptyXteaKey(xteaKey) ? decryptXtea(rawContainer, xteaKey, 5, rawContainer.length) : Buffer.from(rawContainer);
  const stream = new CacheInputStream(container);
  const compressionId = stream.readUnsignedByte();
  const compression = COMPRESSION_BY_ID[compressionId];
  if (!compression) {
    throw new Error(`Unsupported cache container compression id ${compressionId}.`);
  }

  const compressedSize = stream.readInt();
  if (compressedSize < 0 || compressedSize > stream.remaining) {
    throw new Error(`Invalid cache container compressed size ${compressedSize}; remaining=${stream.remaining}.`);
  }

  if (compression === "none") {
    return {
      compression,
      compressedSize,
      decompressedSize: compressedSize,
      data: stream.readBytes(compressedSize),
    };
  }

  const decompressedSize = stream.readInt();
  if (decompressedSize < 0) {
    throw new Error(`Invalid cache container decompressed size ${decompressedSize}.`);
  }

  const payload = stream.readBytes(compressedSize);
  if (compression === "bzip2") {
    const data = Bunzip.decode(Buffer.concat([Buffer.from("BZh1", "ascii"), payload]), decompressedSize);
    return {
      compression,
      compressedSize,
      decompressedSize,
      data,
    };
  }

  const data = zlib.gunzipSync(payload);
  if (data.length !== decompressedSize) {
    throw new Error(`GZip cache container size mismatch: expected ${decompressedSize}, got ${data.length}.`);
  }

  return {
    compression,
    compressedSize,
    decompressedSize,
    data,
  };
}
