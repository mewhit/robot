import { promises as fs } from "fs";
import path from "path";
import * as logger from "../../logger";
import { RobotBitmap } from "../shared/ocr-engine";
import { cropBitmap, saveBitmapAsync } from "../shared/save-bitmap";
import { WorldTile } from "./world-coordinate";

export type WorldMapObservationSource = "overlay" | "tile-location";
export type WorldMapEdgeKind = "walk" | "ladder-up" | "ladder-down";

export type WorldMapObservationCoordinateBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorldMapObservation = {
  sessionId: string;
  botId: string;
  observedAtMs: number;
  source: WorldMapObservationSource;
  confidence: number;
  matchedLine: string;
  tile: WorldTile;
  coordinateBox: WorldMapObservationCoordinateBox | null;
  coordinateBoxScreenshotPath: string | null;
};

type PendingWorldMapObservation = {
  observation: WorldMapObservation;
  screenshotBitmap: RobotBitmap | null;
};

type WorldMapNode = {
  key: string;
  x: number;
  y: number;
  z: number;
  visitCount: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  lastMatchedLine: string;
  lastSource: WorldMapObservationSource;
  maxConfidence: number;
  sourceCounts: Partial<Record<WorldMapObservationSource, number>>;
};

type WorldMapEdge = {
  key: string;
  from: WorldTile;
  to: WorldTile;
  kind: WorldMapEdgeKind;
  count: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
};

type WorldMapChunkFile = {
  version: 1;
  regionId: number;
  worldChunkX: number;
  worldChunkY: number;
  regionChunkX: number;
  regionChunkY: number;
  z: number;
  updatedAtMs: number;
  nodes: Record<string, WorldMapNode>;
  edges: Record<string, WorldMapEdge>;
};

type AsyncWorldMapperOptions = {
  botId: string;
  outputRootPath: string;
  flushIntervalMs?: number;
  flushObservationCount?: number;
};

export type AsyncWorldMapperSession = {
  readonly sessionId: string;
  readonly observationFilePath: string;
  enqueueObservation: (
    observation: Omit<WorldMapObservation, "sessionId" | "botId" | "coordinateBoxScreenshotPath"> & {
      coordinateBoxScreenshotPath?: string | null;
    },
    options?: {
      screenshotBitmap?: RobotBitmap | null;
    },
  ) => void;
  stop: () => Promise<void>;
};

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_FLUSH_OBSERVATION_COUNT = 20;
const MAX_WALK_EDGE_DISTANCE_TILES = 12;

function sanitizePathToken(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "bot"
  );
}

function createSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createObservationLine(observation: WorldMapObservation): string {
  return JSON.stringify(observation);
}

function buildCoordinateBoxScreenshotPath(
  rootPath: string,
  safeBotId: string,
  sessionId: string,
  observationIndex: number,
  observation: Pick<WorldMapObservation, "matchedLine" | "source">,
): string {
  const matchedLineToken = sanitizePathToken(observation.matchedLine.replace(/,/g, "-"));
  const indexToken = String(observationIndex).padStart(6, "0");
  return path.join(
    rootPath,
    "coordinate-box-screenshots",
    safeBotId,
    sessionId,
    `${indexToken}-${observation.source}-${matchedLineToken}.png`,
  );
}

function buildChunkFilePath(rootPath: string, tile: WorldTile): string {
  return path.join(rootPath, "chunks", String(tile.regionId), `chunk-${tile.worldChunkX}-${tile.worldChunkY}-${tile.z}.json`);
}

function createEmptyChunk(tile: WorldTile): WorldMapChunkFile {
  return {
    version: 1,
    regionId: tile.regionId,
    worldChunkX: tile.worldChunkX,
    worldChunkY: tile.worldChunkY,
    regionChunkX: tile.regionChunkX,
    regionChunkY: tile.regionChunkY,
    z: tile.z,
    updatedAtMs: 0,
    nodes: {},
    edges: {},
  };
}

function toWalkDistance(a: WorldTile, b: WorldTile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function toEdgeKey(from: WorldTile, to: WorldTile, kind: WorldMapEdgeKind): string {
  return `${from.key}>${to.key}:${kind}`;
}

function buildEdgeCandidate(previous: WorldMapObservation | null, current: WorldMapObservation): WorldMapEdge | null {
  if (!previous || previous.tile.key === current.tile.key) {
    return null;
  }

  const sameX = previous.tile.x === current.tile.x;
  const sameY = previous.tile.y === current.tile.y;
  const deltaZ = current.tile.z - previous.tile.z;

  if (sameX && sameY && Math.abs(deltaZ) === 1) {
    const kind: WorldMapEdgeKind = deltaZ > 0 ? "ladder-up" : "ladder-down";
    return {
      key: toEdgeKey(previous.tile, current.tile, kind),
      from: previous.tile,
      to: current.tile,
      kind,
      count: 1,
      firstSeenAtMs: current.observedAtMs,
      lastSeenAtMs: current.observedAtMs,
    };
  }

  if (previous.tile.z !== current.tile.z || toWalkDistance(previous.tile, current.tile) > MAX_WALK_EDGE_DISTANCE_TILES) {
    return null;
  }

  return {
    key: toEdgeKey(previous.tile, current.tile, "walk"),
    from: previous.tile,
    to: current.tile,
    kind: "walk",
    count: 1,
    firstSeenAtMs: current.observedAtMs,
    lastSeenAtMs: current.observedAtMs,
  };
}

async function readChunkFile(filePath: string, tile: WorldTile): Promise<WorldMapChunkFile> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as WorldMapChunkFile;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return createEmptyChunk(tile);
    }

    return {
      ...createEmptyChunk(tile),
      ...parsed,
      nodes: parsed.nodes ?? {},
      edges: parsed.edges ?? {},
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("enoent")) {
      logger.warn(`World mapper: could not read chunk ${filePath}: ${message}`);
    }
    return createEmptyChunk(tile);
  }
}

export function createAsyncWorldMapper(options: AsyncWorldMapperOptions): AsyncWorldMapperSession {
  const sessionId = createSessionId();
  const safeBotId = sanitizePathToken(options.botId);
  const rootPath = path.join(options.outputRootPath, "world-map");
  const observationDirPath = path.join(rootPath, "observations", safeBotId);
  const observationFilePath = path.join(observationDirPath, `${sessionId}.jsonl`);
  const flushIntervalMs = Math.max(50, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
  const flushObservationCount = Math.max(1, options.flushObservationCount ?? DEFAULT_FLUSH_OBSERVATION_COUNT);

  const chunkCache = new Map<string, WorldMapChunkFile>();
  let queue: PendingWorldMapObservation[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let flushChain = Promise.resolve();
  let stopped = false;
  let directoriesReady: Promise<void> | null = null;
  let lastPersistedObservation: WorldMapObservation | null = null;
  let nextObservationIndex = 0;

  const ensureDirectories = async (): Promise<void> => {
    if (!directoriesReady) {
      directoriesReady = Promise.all([
        fs.mkdir(observationDirPath, { recursive: true }),
        fs.mkdir(path.join(rootPath, "chunks"), { recursive: true }),
      ]).then(() => undefined);
    }

    await directoriesReady;
  };

  const getOrLoadChunk = async (tile: WorldTile): Promise<{ filePath: string; chunk: WorldMapChunkFile }> => {
    const filePath = buildChunkFilePath(rootPath, tile);
    const cached = chunkCache.get(filePath);
    if (cached) {
      return { filePath, chunk: cached };
    }

    const chunk = await readChunkFile(filePath, tile);
    chunkCache.set(filePath, chunk);
    return { filePath, chunk };
  };

  const queueFlush = (): void => {
    if (stopped || flushTimer) {
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPendingObservations();
    }, flushIntervalMs);
  };

  const upsertObservationNode = (chunk: WorldMapChunkFile, observation: WorldMapObservation): void => {
    const existing = chunk.nodes[observation.tile.key];
    if (!existing) {
      chunk.nodes[observation.tile.key] = {
        key: observation.tile.key,
        x: observation.tile.x,
        y: observation.tile.y,
        z: observation.tile.z,
        visitCount: 1,
        firstSeenAtMs: observation.observedAtMs,
        lastSeenAtMs: observation.observedAtMs,
        lastMatchedLine: observation.matchedLine,
        lastSource: observation.source,
        maxConfidence: observation.confidence,
        sourceCounts: {
          [observation.source]: 1,
        },
      };
      return;
    }

    existing.visitCount += 1;
    existing.lastSeenAtMs = Math.max(existing.lastSeenAtMs, observation.observedAtMs);
    existing.lastMatchedLine = observation.matchedLine;
    existing.lastSource = observation.source;
    existing.maxConfidence = Math.max(existing.maxConfidence, observation.confidence);
    existing.sourceCounts[observation.source] = (existing.sourceCounts[observation.source] ?? 0) + 1;
  };

  const upsertEdge = (chunk: WorldMapChunkFile, edge: WorldMapEdge): void => {
    const existing = chunk.edges[edge.key];
    if (!existing) {
      chunk.edges[edge.key] = edge;
      return;
    }

    existing.count += 1;
    existing.lastSeenAtMs = Math.max(existing.lastSeenAtMs, edge.lastSeenAtMs);
  };

  const persistCoordinateBoxScreenshot = async (entry: PendingWorldMapObservation): Promise<void> => {
    const { observation, screenshotBitmap } = entry;
    if (!screenshotBitmap || !observation.coordinateBox || !observation.coordinateBoxScreenshotPath) {
      return;
    }

    const croppedCoordinateBox = cropBitmap(screenshotBitmap, observation.coordinateBox);
    if (!croppedCoordinateBox) {
      logger.warn(
        `World mapper: could not crop coordinate box screenshot for ${options.botId} observation '${observation.matchedLine}'.`,
      );
      return;
    }

    await saveBitmapAsync(croppedCoordinateBox, observation.coordinateBoxScreenshotPath);
  };

  const persistBatch = async (batch: PendingWorldMapObservation[]): Promise<void> => {
    if (batch.length === 0) {
      return;
    }

    await ensureDirectories();
    for (const entry of batch) {
      await persistCoordinateBoxScreenshot(entry);
    }

    await fs.appendFile(observationFilePath, `${batch.map((entry) => createObservationLine(entry.observation)).join("\n")}\n`, "utf8");

    const dirtyChunkPaths = new Set<string>();

    for (const { observation } of batch) {
      const { filePath, chunk } = await getOrLoadChunk(observation.tile);
      upsertObservationNode(chunk, observation);
      chunk.updatedAtMs = Math.max(chunk.updatedAtMs, observation.observedAtMs);
      dirtyChunkPaths.add(filePath);

      const edge = buildEdgeCandidate(lastPersistedObservation, observation);
      if (edge) {
        const sourceChunkEntry = await getOrLoadChunk(edge.from);
        upsertEdge(sourceChunkEntry.chunk, edge);
        sourceChunkEntry.chunk.updatedAtMs = Math.max(sourceChunkEntry.chunk.updatedAtMs, edge.lastSeenAtMs);
        dirtyChunkPaths.add(sourceChunkEntry.filePath);
      }

      lastPersistedObservation = observation;
    }

    for (const dirtyChunkPath of dirtyChunkPaths) {
      const chunk = chunkCache.get(dirtyChunkPath);
      if (!chunk) {
        continue;
      }

      await fs.mkdir(path.dirname(dirtyChunkPath), { recursive: true });
      await fs.writeFile(dirtyChunkPath, `${JSON.stringify(chunk, null, 2)}\n`, "utf8");
    }
  };

  const flushPendingObservations = async (): Promise<void> => {
    if (queue.length === 0) {
      return flushChain;
    }

    const batch = queue;
    queue = [];

    flushChain = flushChain
      .then(() => persistBatch(batch))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`World mapper: flush failed for ${options.botId}: ${message}`);
      });

    return flushChain;
  };

  return {
    sessionId,
      observationFilePath,
    enqueueObservation: (observation, enqueueOptions) => {
      if (stopped) {
        return;
      }

      nextObservationIndex += 1;
      const coordinateBoxScreenshotPath =
        observation.coordinateBoxScreenshotPath ??
        (observation.coordinateBox
          ? buildCoordinateBoxScreenshotPath(rootPath, safeBotId, sessionId, nextObservationIndex, observation)
          : null);

      queue.push({
        observation: {
          ...observation,
          sessionId,
          botId: options.botId,
          coordinateBoxScreenshotPath,
        },
        screenshotBitmap: enqueueOptions?.screenshotBitmap ?? null,
      });

      if (queue.length >= flushObservationCount) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        void flushPendingObservations();
        return;
      }

      queueFlush();
    },
    stop: async () => {
      if (stopped) {
        return flushChain;
      }

      stopped = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      await flushPendingObservations();
      await flushChain;
    },
  };
}
