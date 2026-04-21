import { AppState } from "./global-state";
import { getRunLiteWindowInfo } from "./ioHookHandlers";
import { sendMarkerColorState } from "./recordingManager";
import { RuneLiteWindowInfo } from "./runeLiteWindow";
import { ScreenBitmap, captureScreenRect } from "./windowsScreenCapture";

type RobotBitmap = ScreenBitmap;

type MarkerColor = "green" | "red" | "none";

type MarkerDetection = {
  color: Exclude<MarkerColor, "none">;
  x: number;
  y: number;
  confidence: number;
};

const MARKER_SCAN_INTERVAL_MS = 700;
const MARKER_SCAN_STEP_PX = 2;
const MIN_MATCHED_SAMPLES = 4;
const STATE_PUSH_MOVE_PX = 20;
const STATE_PUSH_CONFIDENCE_DELTA = 0.1;
const YIELD_EVERY_ROW_COUNT = 3;

let scanTimer: NodeJS.Timeout | null = null;
let isWatcherRunning = false;

export function startColorWatcher() {
  if (isWatcherRunning) {
    return;
  }

  isWatcherRunning = true;
  void runWatcherLoop();
}

export function stopColorWatcher() {
  isWatcherRunning = false;

  if (scanTimer !== null) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
}

export async function testColorDetectionOnce() {
  try {
    await scanAndPublishMarkerState(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Color detection test failed: ${message}`);
  }
}

export async function detectMarkerState(): Promise<{
  color: MarkerColor;
  point: { x: number; y: number } | null;
  confidence: number;
}> {
  await scanAndPublishMarkerState(false);

  return {
    color: AppState.markerColor,
    point: AppState.markerPoint,
    confidence: AppState.markerConfidence,
  };
}

async function runWatcherLoop() {
  while (isWatcherRunning) {
    const startedAt = Date.now();

    try {
      await scanAndPublishMarkerState(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Color watcher scan failed: ${message}`);
    }

    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, MARKER_SCAN_INTERVAL_MS - elapsed);
    if (!isWatcherRunning) {
      break;
    }

    await sleep(waitMs);
  }
}

async function scanAndPublishMarkerState(abortOnStop = true) {
  const runeliteBounds = getRunLiteWindowInfo();
  if (!runeliteBounds) {
    console.log("[colorWatcher] No RuneLite window found");
    publishMarkerState({ color: "none", x: null, y: null, confidence: 0 });
    return;
  }

  console.log(
    `[colorWatcher] Scanning bounds: x=${runeliteBounds.x} y=${runeliteBounds.y} w=${runeliteBounds.width} h=${runeliteBounds.height}`,
  );

  const detection = await detectMarkerColor(runeliteBounds, abortOnStop);
  if (!detection) {
    console.log("[colorWatcher] No marker detected");
    publishMarkerState({ color: "none", x: null, y: null, confidence: 0 });
    return;
  }

  console.log(
    `[colorWatcher] Detected: ${detection.color} at (${detection.x}, ${detection.y}) confidence=${detection.confidence}`,
  );
  publishMarkerState({
    color: detection.color,
    x: detection.x,
    y: detection.y,
    confidence: detection.confidence,
  });
}

function publishMarkerState(payload: { color: MarkerColor; x: number | null; y: number | null; confidence: number }) {
  const previousColor = AppState.markerColor;
  const previousPoint = AppState.markerPoint;
  const previousConfidence = AppState.markerConfidence;

  const nextPoint = payload.x !== null && payload.y !== null ? { x: payload.x, y: payload.y } : null;

  const colorChanged = previousColor !== payload.color;
  const confidenceChanged = Math.abs(previousConfidence - payload.confidence) >= STATE_PUSH_CONFIDENCE_DELTA;
  const moved =
    previousPoint === null ||
    nextPoint === null ||
    Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y) >= STATE_PUSH_MOVE_PX;

  AppState.markerColor = payload.color;
  AppState.markerConfidence = payload.confidence;
  AppState.markerPoint = nextPoint;

  if (colorChanged || confidenceChanged || moved) {
    sendMarkerColorState();
  }

  if (colorChanged && (payload.color === "green" || payload.color === "red")) {
    const pointLog = nextPoint ? ` at (${nextPoint.x}, ${nextPoint.y})` : "";
    console.log(`Marker color changed: ${previousColor} -> ${payload.color}${pointLog}`);
  }
}

async function detectMarkerColor(bounds: RuneLiteWindowInfo, abortOnStop: boolean): Promise<MarkerDetection | null> {
  const search = getSearchRegion(bounds);
  const captureWidth = search.right - search.left + 1;
  const captureHeight = search.bottom - search.top + 1;

  console.log(
    `[detectMarker] search region: left=${search.left} top=${search.top} w=${captureWidth} h=${captureHeight}`,
  );

  let bitmap: RobotBitmap;
  try {
    bitmap = captureScreenRect(search.left, search.top, captureWidth, captureHeight);
    console.log(
      `[detectMarker] bitmap captured: ${bitmap.width}x${bitmap.height} bpp=${bitmap.bytesPerPixel} byteWidth=${bitmap.byteWidth} imageLen=${bitmap.image?.length}`,
    );
    // Sample center pixel via direct buffer read to verify channel order
    const cx = Math.floor(captureWidth / 2);
    const cy = Math.floor(captureHeight / 2);
    const sampleViaColorAt = bitmap.colorAt(cx, cy);
    const off = cy * bitmap.byteWidth + cx * bitmap.bytesPerPixel;
    const sampleDirect = `b=${bitmap.image[off]} g=${bitmap.image[off + 1]} r=${bitmap.image[off + 2]}`;
    console.log(`[detectMarker] center pixel colorAt=${sampleViaColorAt} directBuffer=${sampleDirect}`);
  } catch (err) {
    console.error(`[detectMarker] screen.capture threw:`, err);
    return null;
  }

  // Read pixels directly from the raw image Buffer (BGRA layout on Windows)
  // to avoid making a native C++ call per pixel (114k calls would take minutes).
  const image = bitmap.image;
  const byteWidth = bitmap.byteWidth;
  const bpp = bitmap.bytesPerPixel;

  let greenCount = 0;
  let redCount = 0;

  let greenScoreSum = 0;
  let redScoreSum = 0;

  let greenXSum = 0;
  let greenYSum = 0;
  let redXSum = 0;
  let redYSum = 0;

  let scannedRows = 0;
  let loopError: unknown = null;

  try {
    for (let by = 0; by < captureHeight; by += MARKER_SCAN_STEP_PX) {
      if (abortOnStop && !isWatcherRunning) {
        return null;
      }

      for (let bx = 0; bx < captureWidth; bx += MARKER_SCAN_STEP_PX) {
        const offset = by * byteWidth + bx * bpp;
        // Windows DIB format: bytes are BGRA
        const b = image[offset];
        const g = image[offset + 1];
        const r = image[offset + 2];

        const absX = search.left + bx;
        const absY = search.top + by;

        const gScore = scoreGreen(r, g, b);
        if (gScore > 0) {
          greenCount += 1;
          greenScoreSum += gScore;
          greenXSum += absX * gScore;
          greenYSum += absY * gScore;
        }

        const rScore = scoreRed(r, g, b);
        if (rScore > 0) {
          redCount += 1;
          redScoreSum += rScore;
          redXSum += absX * rScore;
          redYSum += absY * rScore;
        }
      }

      scannedRows += 1;
      if (scannedRows % YIELD_EVERY_ROW_COUNT === 0) {
        await yieldToEventLoop();
      }
    }
  } catch (err) {
    loopError = err;
  }

  console.log(
    `[detectMarker] scan done — greenCount=${greenCount} redCount=${redCount} scannedRows=${scannedRows} loopError=${loopError}`,
  );

  const hasGreen = greenCount >= MIN_MATCHED_SAMPLES;
  const hasRed = redCount >= MIN_MATCHED_SAMPLES;

  if (!hasGreen && !hasRed) {
    return null;
  }

  if (hasGreen && (!hasRed || greenScoreSum >= redScoreSum)) {
    return {
      color: "green",
      x: Math.round(greenXSum / greenScoreSum),
      y: Math.round(greenYSum / greenScoreSum),
      confidence: normalizeConfidence(greenScoreSum, greenCount),
    };
  }

  return {
    color: "red",
    x: Math.round(redXSum / redScoreSum),
    y: Math.round(redYSum / redScoreSum),
    confidence: normalizeConfidence(redScoreSum, redCount),
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    scanTimer = setTimeout(resolve, ms);
  });
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function getSearchRegion(bounds: RuneLiteWindowInfo) {
  // Restrict scan to the 3D scene area to avoid UI reds/greens on side panels and chat.
  const left = Math.round(bounds.x + bounds.width * 0.04);
  const right = Math.round(bounds.x + bounds.width * 0.78);
  const top = Math.round(bounds.y + bounds.height * 0.05);
  const bottom = Math.round(bounds.y + bounds.height * 0.72);

  return { left, right, top, bottom };
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const safeHex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(safeHex)) {
    return null;
  }

  const color = Number.parseInt(safeHex, 16);
  if (!Number.isFinite(color)) {
    return null;
  }

  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  };
}

function scoreGreen(r: number, g: number, b: number): number {
  // RuneLite obstacle highlight is pure lime: ARGB FF00FF00 → R=0, G=255, B=0.
  // Require very high G and both R and B clearly dominated by G.
  if (g < 150) {
    return 0;
  }

  const dominance = g - Math.max(r, b);
  if (dominance < 80) {
    return 0;
  }

  // Extra boost for near-pure lime (R<30, B<30)
  const purity = r < 30 && b < 30 ? 80 : 0;
  return dominance + purity;
}

function scoreRed(r: number, g: number, b: number): number {
  // RuneLite marker is pure red: ARGB FFFF0000 → R=255, G=0, B=0.
  if (r < 150) {
    return 0;
  }

  const dominance = r - Math.max(g, b);
  if (dominance < 80) {
    return 0;
  }

  // Extra boost for near-pure red (G<30, B<30)
  const purity = g < 30 && b < 30 ? 80 : 0;
  return dominance + purity;
}

function normalizeConfidence(scoreSum: number, sampleCount: number): number {
  if (sampleCount <= 0) {
    return 0;
  }

  const averageScore = scoreSum / sampleCount;
  const normalized = Math.min(1, averageScore / 180);
  return Math.round(normalized * 100) / 100;
}
