import * as robotModule from "robotjs";
import { AppState } from "./global-state";
import { getRunLiteWindowInfo, RuneLiteWindowInfo } from "./ioHookHandlers";
import { sendMarkerColorState } from "./recordingManager";

type RobotColorApi = {
  getPixelColor: (x: number, y: number) => string;
};

type MarkerColor = "green" | "red" | "none";

type MarkerDetection = {
  color: Exclude<MarkerColor, "none">;
  x: number;
  y: number;
  confidence: number;
};

const robot = ((robotModule as unknown as { default?: RobotColorApi }).default ??
  robotModule) as unknown as RobotColorApi;

const MARKER_SCAN_INTERVAL_MS = 700;
const MARKER_SCAN_STEP_PX = 16;
const MIN_MATCHED_SAMPLES = 12;
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

async function runWatcherLoop() {
  while (isWatcherRunning) {
    const startedAt = Date.now();

    try {
      await scanAndPublishMarkerState();
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

async function scanAndPublishMarkerState() {
  const runeliteBounds = getRunLiteWindowInfo();
  if (!runeliteBounds) {
    publishMarkerState({ color: "none", x: null, y: null, confidence: 0 });
    return;
  }

  const detection = await detectMarkerColor(runeliteBounds);
  if (!detection) {
    publishMarkerState({ color: "none", x: null, y: null, confidence: 0 });
    return;
  }

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

async function detectMarkerColor(bounds: RuneLiteWindowInfo): Promise<MarkerDetection | null> {
  const search = getSearchRegion(bounds);

  let greenCount = 0;
  let redCount = 0;

  let greenScoreSum = 0;
  let redScoreSum = 0;

  let greenXSum = 0;
  let greenYSum = 0;
  let redXSum = 0;
  let redYSum = 0;

  let scannedRows = 0;
  for (let y = search.top; y <= search.bottom; y += MARKER_SCAN_STEP_PX) {
    if (!isWatcherRunning) {
      return null;
    }

    for (let x = search.left; x <= search.right; x += MARKER_SCAN_STEP_PX) {
      const hex = robot.getPixelColor(x, y);
      const rgb = parseHexColor(hex);
      if (!rgb) {
        continue;
      }

      const gScore = scoreGreen(rgb.r, rgb.g, rgb.b);
      if (gScore > 0) {
        greenCount += 1;
        greenScoreSum += gScore;
        greenXSum += x * gScore;
        greenYSum += y * gScore;
      }

      const rScore = scoreRed(rgb.r, rgb.g, rgb.b);
      if (rScore > 0) {
        redCount += 1;
        redScoreSum += rScore;
        redXSum += x * rScore;
        redYSum += y * rScore;
      }
    }

    scannedRows += 1;
    if (scannedRows % YIELD_EVERY_ROW_COUNT === 0) {
      await yieldToEventLoop();
    }
  }

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
  if (g < 120) {
    return 0;
  }

  const dominance = g - Math.max(r, b);
  if (dominance < 35) {
    return 0;
  }

  const brightness = Math.max(r, g, b);
  return dominance + brightness * 0.25;
}

function scoreRed(r: number, g: number, b: number): number {
  if (r < 120) {
    return 0;
  }

  const dominance = r - Math.max(g, b);
  if (dominance < 35) {
    return 0;
  }

  const brightness = Math.max(r, g, b);
  return dominance + brightness * 0.25;
}

function normalizeConfidence(scoreSum: number, sampleCount: number): number {
  if (sampleCount <= 0) {
    return 0;
  }

  const averageScore = scoreSum / sampleCount;
  const normalized = Math.min(1, averageScore / 180);
  return Math.round(normalized * 100) / 100;
}
