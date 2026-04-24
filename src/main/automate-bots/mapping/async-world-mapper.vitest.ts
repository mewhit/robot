import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createAsyncWorldMapper } from "./async-world-mapper";
import { deriveWorldTile } from "./world-coordinate";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "robot-world-map-"));
  tempRoots.push(root);
  return root;
}

function createSolidBitmap(width: number, height: number): {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
} {
  const image = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      image[offset] = 32;
      image[offset + 1] = 96;
      image[offset + 2] = 224;
      image[offset + 3] = 255;
    }
  }

  return {
    width,
    height,
    byteWidth: width * 4,
    bytesPerPixel: 4,
    image,
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    }),
  );
});

describe("async-world-mapper", () => {
  it("writes observation logs and chunk files", async () => {
    const root = await createTempRoot();
    const screenshotBitmap = createSolidBitmap(16, 10);
    const mapper = createAsyncWorldMapper({
      botId: "Motherlode Mine V3",
      outputRootPath: root,
      flushIntervalMs: 10,
      flushObservationCount: 2,
    });

    mapper.enqueueObservation({
      observedAtMs: 1_000,
      source: "overlay",
      confidence: 0.65,
      matchedLine: "3755,5672,0",
      tile: deriveWorldTile(3755, 5672, 0),
      coordinateBox: { x: 2, y: 1, width: 6, height: 3 },
    }, {
      screenshotBitmap,
    });
    mapper.enqueueObservation({
      observedAtMs: 1_600,
      source: "overlay",
      confidence: 0.65,
      matchedLine: "3756,5672,0",
      tile: deriveWorldTile(3756, 5672, 0),
      coordinateBox: { x: 3, y: 1, width: 6, height: 3 },
    }, {
      screenshotBitmap,
    });

    await mapper.stop();

    const observationContent = await fs.readFile(mapper.observationFilePath, "utf8");
    const observationLines = observationContent.trim().split("\n");
    expect(observationLines).toHaveLength(2);
    const firstObservation = JSON.parse(observationLines[0]) as {
      coordinateBox: { x: number; y: number; width: number; height: number } | null;
      coordinateBoxScreenshotPath: string | null;
    };
    expect(firstObservation.coordinateBox).toEqual({ x: 2, y: 1, width: 6, height: 3 });
    expect(firstObservation.coordinateBoxScreenshotPath).toMatch(/coordinate-box-screenshots/);
    const screenshotStat = await fs.stat(firstObservation.coordinateBoxScreenshotPath!);
    expect(screenshotStat.isFile()).toBe(true);

    const firstChunkPath = path.join(root, "world-map", "chunks", String((3755 >> 6 << 8) | (5672 >> 6)), "chunk-469-709-0.json");
    const firstChunkRaw = await fs.readFile(firstChunkPath, "utf8");
    const firstChunk = JSON.parse(firstChunkRaw) as {
      nodes: Record<string, { visitCount: number }>;
      edges: Record<string, { kind: string; count: number }>;
    };

    expect(firstChunk.nodes["3755,5672,0"]?.visitCount).toBe(1);
    expect(firstChunk.nodes["3756,5672,0"]?.visitCount).toBe(1);
    expect(firstChunk.edges["3755,5672,0>3756,5672,0:walk"]?.kind).toBe("walk");
    expect(firstChunk.edges["3755,5672,0>3756,5672,0:walk"]?.count).toBe(1);
  });

  it("records ladder edges for vertical transitions on the same tile", async () => {
    const root = await createTempRoot();
    const mapper = createAsyncWorldMapper({
      botId: "Test Bot",
      outputRootPath: root,
      flushIntervalMs: 10,
      flushObservationCount: 10,
    });

    mapper.enqueueObservation({
      observedAtMs: 2_000,
      source: "overlay",
      confidence: 0.65,
      matchedLine: "3200,3200,0",
      tile: deriveWorldTile(3200, 3200, 0),
      coordinateBox: null,
    });
    mapper.enqueueObservation({
      observedAtMs: 2_600,
      source: "overlay",
      confidence: 0.65,
      matchedLine: "3200,3200,1",
      tile: deriveWorldTile(3200, 3200, 1),
      coordinateBox: null,
    });

    await mapper.stop();

    const chunkPath = path.join(root, "world-map", "chunks", String((3200 >> 6 << 8) | (3200 >> 6)), "chunk-400-400-0.json");
    const chunk = JSON.parse(await fs.readFile(chunkPath, "utf8")) as {
      edges: Record<string, { kind: string }>;
    };

    expect(chunk.edges["3200,3200,0>3200,3200,1:ladder-up"]?.kind).toBe("ladder-up");
  });
});
