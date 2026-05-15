import fs from "fs";
import os from "os";
import path from "path";
import { decompressCacheContainer } from "./cache-container";
import { CacheInputStream } from "./cache-input-stream";
import { XteaKey } from "./xtea";

export const OSRS_CACHE_INDEX_CONFIGS = 2;
export const OSRS_CACHE_INDEX_MAPS = 5;
export const OSRS_ITEM_DEFINITION_ARCHIVE_ID = 10;
export const OSRS_OBJECT_DEFINITION_ARCHIVE_ID = 6;
export const OSRS_MAP_TERRAIN_FILE_ID = 0;
export const OSRS_MAP_LOCATIONS_FILE_ID = 1;
export const PROJECT_OSRS_CACHE_DIRECTORY = path.resolve(process.cwd(), "data", "osrs-cache");

export type CacheArchiveReference = {
  id: number;
  crc: number;
  revision: number;
  fileIds: number[];
  compressedSize?: number;
  decompressedSize?: number;
};

export type CacheIndexReference = {
  protocol: number;
  revision: number;
  flags: number;
  archives: Map<number, CacheArchiveReference>;
};

export type OsrsCacheArchive = {
  indexId: number;
  archiveId: number;
  reference: CacheArchiveReference | null;
  data: Buffer;
  files: Map<number, Buffer>;
};

export type OsrsCacheStore = {
  readonly directoryPath: string;
  readArchive: (indexId: number, archiveId: number, xteaKey?: XteaKey) => OsrsCacheArchive;
  readArchiveFile: (indexId: number, archiveId: number, fileId: number, xteaKey?: XteaKey) => Buffer;
  readIndexReference: (indexId: number) => CacheIndexReference;
  close: () => void;
};

export type OsrsCacheSnapshotResult = {
  sourceDirectoryPath: string;
  targetDirectoryPath: string;
  copiedFiles: string[];
  skippedFiles: string[];
  alreadyPresent: boolean;
};

const INDEX_REFERENCE_INDEX_ID = 255;
const SECTOR_SIZE = 520;
const SMALL_SECTOR_HEADER_SIZE = 8;
const LARGE_SECTOR_HEADER_SIZE = 10;
const OSRS_CACHE_FILE_NAME_PATTERN = /^main_file_cache\.(?:dat2|idx\d+)$/;

function readMedium(buffer: Buffer, offset: number): number {
  return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
}

function readLargeSmart(stream: CacheInputStream): number {
  const first = stream.peekUnsignedByte();
  return first < 128 ? stream.readUnsignedShort() : stream.readInt() & 0x7fffffff;
}

function parseIndexReference(data: Buffer): CacheIndexReference {
  const stream = new CacheInputStream(data);
  const protocol = stream.readUnsignedByte();
  if (protocol < 5 || protocol > 7) {
    throw new Error(`Unsupported cache reference table protocol ${protocol}.`);
  }

  const revision = protocol >= 6 ? stream.readInt() : 0;
  const flags = stream.readUnsignedByte();
  const archiveCount = protocol >= 7 ? readLargeSmart(stream) : stream.readUnsignedShort();
  const archiveIds: number[] = [];
  let archiveId = 0;
  for (let i = 0; i < archiveCount; i += 1) {
    archiveId += protocol >= 7 ? readLargeSmart(stream) : stream.readUnsignedShort();
    archiveIds.push(archiveId);
  }

  if ((flags & 1) !== 0) {
    stream.skip(archiveCount * 4);
  }

  const crcs = archiveIds.map(() => stream.readInt());
  if ((flags & 2) !== 0) {
    stream.skip(archiveCount * 64);
  }

  const compressedSizes: Array<number | undefined> = [];
  const decompressedSizes: Array<number | undefined> = [];
  if ((flags & 4) !== 0) {
    for (let i = 0; i < archiveCount; i += 1) {
      compressedSizes.push(stream.readInt());
      decompressedSizes.push(stream.readInt());
    }
  }

  const revisions = archiveIds.map(() => stream.readInt());
  const fileCounts = archiveIds.map(() => (protocol >= 7 ? readLargeSmart(stream) : stream.readUnsignedShort()));
  const archives = new Map<number, CacheArchiveReference>();

  for (let i = 0; i < archiveIds.length; i += 1) {
    const fileIds: number[] = [];
    let fileId = 0;
    for (let fileIndex = 0; fileIndex < fileCounts[i]; fileIndex += 1) {
      fileId += protocol >= 7 ? readLargeSmart(stream) : stream.readUnsignedShort();
      fileIds.push(fileId);
    }

    archives.set(archiveIds[i], {
      id: archiveIds[i],
      crc: crcs[i],
      revision: revisions[i],
      fileIds,
      compressedSize: compressedSizes[i],
      decompressedSize: decompressedSizes[i],
    });
  }

  if ((flags & 1) !== 0) {
    for (let i = 0; i < archiveIds.length; i += 1) {
      stream.skip(fileCounts[i] * 4);
    }
  }

  return {
    protocol,
    revision,
    flags,
    archives,
  };
}

function unpackArchiveFiles(data: Buffer, fileIds: readonly number[]): Map<number, Buffer> {
  if (fileIds.length === 0) {
    return new Map();
  }

  if (fileIds.length === 1) {
    return new Map([[fileIds[0], data]]);
  }

  const chunkCount = data[data.length - 1];
  if (chunkCount <= 0) {
    throw new Error(`Invalid cache archive chunk count ${chunkCount}.`);
  }

  const footerSize = chunkCount * fileIds.length * 4;
  const footerOffset = data.length - 1 - footerSize;
  if (footerOffset < 0) {
    throw new Error(`Invalid cache archive footer: chunks=${chunkCount}, files=${fileIds.length}, size=${data.length}.`);
  }

  const chunkSizes = Array.from({ length: fileIds.length }, () => Array.from({ length: chunkCount }, () => 0));
  const fileSizes = Array.from({ length: fileIds.length }, () => 0);
  let footerCursor = footerOffset;
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    let chunkSize = 0;
    for (let fileIndex = 0; fileIndex < fileIds.length; fileIndex += 1) {
      chunkSize += data.readInt32BE(footerCursor);
      footerCursor += 4;
      chunkSizes[fileIndex][chunkIndex] = chunkSize;
      fileSizes[fileIndex] += chunkSize;
    }
  }

  const files = fileSizes.map((size) => Buffer.alloc(size));
  const fileOffsets = Array.from({ length: fileIds.length }, () => 0);
  let dataCursor = 0;
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    for (let fileIndex = 0; fileIndex < fileIds.length; fileIndex += 1) {
      const chunkSize = chunkSizes[fileIndex][chunkIndex];
      data.copy(files[fileIndex], fileOffsets[fileIndex], dataCursor, dataCursor + chunkSize);
      dataCursor += chunkSize;
      fileOffsets[fileIndex] += chunkSize;
    }
  }

  return new Map(fileIds.map((fileId, index) => [fileId, files[index]]));
}

function hasCacheFiles(directoryPath: string): boolean {
  return (
    fs.existsSync(path.join(directoryPath, "main_file_cache.dat2")) &&
    fs.existsSync(path.join(directoryPath, "main_file_cache.idx255")) &&
    fs.existsSync(path.join(directoryPath, `main_file_cache.idx${OSRS_CACHE_INDEX_MAPS}`)) &&
    fs.existsSync(path.join(directoryPath, `main_file_cache.idx${OSRS_CACHE_INDEX_CONFIGS}`))
  );
}

export function hasOsrsCacheFiles(directoryPath: string): boolean {
  return hasCacheFiles(directoryPath);
}

function listOsrsCacheFileNames(directoryPath: string): string[] {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath)
    .filter((name) => OSRS_CACHE_FILE_NAME_PATTERN.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function shouldCopyCacheFile(sourcePath: string, targetPath: string, forceRefresh: boolean): boolean {
  if (forceRefresh || !fs.existsSync(targetPath)) {
    return true;
  }

  const sourceStat = fs.statSync(sourcePath);
  const targetStat = fs.statSync(targetPath);
  return sourceStat.size !== targetStat.size || sourceStat.mtimeMs > targetStat.mtimeMs + 1000;
}

export function findProjectOsrsCacheDirectory(): string | null {
  return hasCacheFiles(PROJECT_OSRS_CACHE_DIRECTORY) ? PROJECT_OSRS_CACHE_DIRECTORY : null;
}

export function findExternalOsrsCacheDirectory(): string | null {
  const candidates = [
    process.env.OSRS_CACHE_DIR,
    path.join(os.homedir(), ".runelite", "jagexcache", "oldschool", "LIVE"),
    path.join(os.homedir(), "jagexcache", "oldschool", "LIVE"),
    path.join(os.homedir(), "jagexcache", "oldschool"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Jagex", "Old School Runescape", "data")
      : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(hasCacheFiles) ?? null;
}

export function findOsrsCacheDirectory(): string | null {
  const configuredDirectory = process.env.OSRS_CACHE_DIR;
  if (configuredDirectory && hasCacheFiles(configuredDirectory)) {
    return configuredDirectory;
  }

  return findProjectOsrsCacheDirectory() ?? findExternalOsrsCacheDirectory();
}

export function ensureProjectOsrsCacheSnapshot(params: {
  sourceDirectoryPath?: string | null;
  targetDirectoryPath?: string;
  forceRefresh?: boolean;
} = {}): OsrsCacheSnapshotResult {
  const targetDirectoryPath = params.targetDirectoryPath ?? PROJECT_OSRS_CACHE_DIRECTORY;
  const forceRefresh = params.forceRefresh ?? false;
  const targetAlreadyValid = hasCacheFiles(targetDirectoryPath);
  const sourceDirectoryPath = params.sourceDirectoryPath ?? findExternalOsrsCacheDirectory();

  if (targetAlreadyValid && !sourceDirectoryPath && !forceRefresh) {
    return {
      sourceDirectoryPath: targetDirectoryPath,
      targetDirectoryPath,
      copiedFiles: [],
      skippedFiles: listOsrsCacheFileNames(targetDirectoryPath),
      alreadyPresent: true,
    };
  }

  if (!sourceDirectoryPath) {
    throw new Error("Could not find an external OSRS cache directory to snapshot.");
  }

  const resolvedSource = path.resolve(sourceDirectoryPath);
  const resolvedTarget = path.resolve(targetDirectoryPath);
  if (resolvedSource === resolvedTarget) {
    return {
      sourceDirectoryPath: resolvedSource,
      targetDirectoryPath: resolvedTarget,
      copiedFiles: [],
      skippedFiles: listOsrsCacheFileNames(resolvedTarget),
      alreadyPresent: hasCacheFiles(resolvedTarget),
    };
  }

  if (!hasCacheFiles(resolvedSource)) {
    throw new Error(`External OSRS cache directory is missing required cache files: ${resolvedSource}.`);
  }

  fs.mkdirSync(resolvedTarget, { recursive: true });

  const copiedFiles: string[] = [];
  const skippedFiles: string[] = [];
  for (const fileName of listOsrsCacheFileNames(resolvedSource)) {
    const sourcePath = path.join(resolvedSource, fileName);
    const targetPath = path.join(resolvedTarget, fileName);
    if (shouldCopyCacheFile(sourcePath, targetPath, forceRefresh)) {
      fs.copyFileSync(sourcePath, targetPath);
      copiedFiles.push(fileName);
    } else {
      skippedFiles.push(fileName);
    }
  }

  if (!hasCacheFiles(resolvedTarget)) {
    throw new Error(`Project OSRS cache snapshot is incomplete after copy: ${resolvedTarget}.`);
  }

  return {
    sourceDirectoryPath: resolvedSource,
    targetDirectoryPath: resolvedTarget,
    copiedFiles,
    skippedFiles,
    alreadyPresent: copiedFiles.length === 0,
  };
}

export function openOsrsCacheStore(directoryPath = findOsrsCacheDirectory()): OsrsCacheStore {
  if (!directoryPath) {
    throw new Error("Could not find an OSRS cache directory. Set OSRS_CACHE_DIR to a directory containing main_file_cache.dat2.");
  }

  if (!hasCacheFiles(directoryPath)) {
    throw new Error(`OSRS cache directory is missing required cache files: ${directoryPath}.`);
  }

  const datFd = fs.openSync(path.join(directoryPath, "main_file_cache.dat2"), "r");
  const indexReferences = new Map<number, CacheIndexReference>();
  const archiveCache = new Map<string, OsrsCacheArchive>();

  const readRawArchive = (indexId: number, archiveId: number): Buffer => {
    const indexPath = path.join(directoryPath, `main_file_cache.idx${indexId}`);
    const indexFd = fs.openSync(indexPath, "r");
    try {
      const entry = Buffer.alloc(6);
      const bytesRead = fs.readSync(indexFd, entry, 0, entry.length, archiveId * 6);
      if (bytesRead !== entry.length) {
        throw new Error(`Cache archive ${indexId}:${archiveId} is not present in ${indexPath}.`);
      }

      const size = readMedium(entry, 0);
      let sector = readMedium(entry, 3);
      if (size <= 0 || sector <= 0) {
        throw new Error(`Cache archive ${indexId}:${archiveId} has invalid size=${size} sector=${sector}.`);
      }

      const output = Buffer.alloc(size);
      let outputOffset = 0;
      let chunk = 0;
      while (outputOffset < size) {
        const largeArchive = archiveId > 0xffff;
        const headerSize = largeArchive ? LARGE_SECTOR_HEADER_SIZE : SMALL_SECTOR_HEADER_SIZE;
        const header = Buffer.alloc(headerSize);
        const sectorOffset = sector * SECTOR_SIZE;
        if (fs.readSync(datFd, header, 0, header.length, sectorOffset) !== header.length) {
          throw new Error(`Could not read cache sector ${sector} for archive ${indexId}:${archiveId}.`);
        }

        const sectorArchiveId = largeArchive ? header.readUInt32BE(0) : header.readUInt16BE(0);
        const sectorChunk = header.readUInt16BE(largeArchive ? 4 : 2);
        const nextSector = readMedium(header, largeArchive ? 6 : 4);
        const sectorIndexId = header[largeArchive ? 9 : 7];
        if (sectorArchiveId !== archiveId || sectorChunk !== chunk || sectorIndexId !== indexId) {
          throw new Error(
            `Invalid cache sector header for ${indexId}:${archiveId}; got archive=${sectorArchiveId}, chunk=${sectorChunk}, index=${sectorIndexId}.`,
          );
        }

        const payloadSize = Math.min(size - outputOffset, SECTOR_SIZE - headerSize);
        if (fs.readSync(datFd, output, outputOffset, payloadSize, sectorOffset + headerSize) !== payloadSize) {
          throw new Error(`Could not read cache sector payload ${sector} for archive ${indexId}:${archiveId}.`);
        }

        outputOffset += payloadSize;
        sector = nextSector;
        chunk += 1;
      }

      return output;
    } finally {
      fs.closeSync(indexFd);
    }
  };

  const readIndexReference = (indexId: number): CacheIndexReference => {
    const cached = indexReferences.get(indexId);
    if (cached) {
      return cached;
    }

    const rawReference = readRawArchive(INDEX_REFERENCE_INDEX_ID, indexId);
    const reference = parseIndexReference(decompressCacheContainer(rawReference).data);
    indexReferences.set(indexId, reference);
    return reference;
  };

  const readArchive = (indexId: number, archiveId: number, xteaKey?: XteaKey): OsrsCacheArchive => {
    const cacheKey = `${indexId}:${archiveId}:${xteaKey?.join(",") ?? ""}`;
    const cached = archiveCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const reference = indexId === INDEX_REFERENCE_INDEX_ID ? null : readIndexReference(indexId).archives.get(archiveId) ?? null;
    const rawArchive = readRawArchive(indexId, archiveId);
    const data = decompressCacheContainer(rawArchive, xteaKey).data;
    const files = unpackArchiveFiles(data, reference?.fileIds ?? [0]);
    const archive: OsrsCacheArchive = {
      indexId,
      archiveId,
      reference,
      data,
      files,
    };
    archiveCache.set(cacheKey, archive);
    return archive;
  };

  return {
    directoryPath,
    readArchive,
    readArchiveFile: (indexId, archiveId, fileId, xteaKey) => {
      const file = readArchive(indexId, archiveId, xteaKey).files.get(fileId);
      if (!file) {
        throw new Error(`Cache file ${indexId}:${archiveId}:${fileId} is not present.`);
      }

      return file;
    },
    readIndexReference,
    close: () => {
      fs.closeSync(datFd);
    },
  };
}
