import * as robotModule from "robotjs";
import { detectMarkerState } from "../colorWatcher";
import { AppState } from "../global-state";
import { getRuneLite } from "../runeLiteWindow";
import { Window } from "node-window-manager";
import { findColorShapesInBounds } from "../colorDetection";
import { Coordinate } from "../colorDetection.types";
import { mouseClick, moveMouse } from "robotjs";
import { setAutomateBotCurrentStep } from "../automateBotManager";

export const FALADOR_ROOFTOP_BOT_ID = "falador-rooftop";

const SCROLL_TICKS = 35;
const SCROLL_DELTA_Y = 120;
const GREEN_DETECTION_MAX_ATTEMPTS = 8;
const GREEN_DETECTION_RETRY_DELAY_MS = 350;
const GREEN_CLICK_RANDOM_OFFSET_PX = 5;
const GREEN_CLICK_RANDOM_CANDIDATE_ATTEMPTS = 12;
const GREEN_SCAN_LOOP_DELAY_MS = 5000;
const NEW_MARKER_MIN_MOVE_PX = 6;
const SAME_MARKER_RECLICK_COOLDOWN_MS = 15000;

let isFaladorLoopRunning = false;
let lastHandledMarker: { x: number; y: number; atMs: number } | null = null;

type RobotScrollApi = {
  scrollMouse?: (x: number, y: number) => void;
  moveMouse?: (x: number, y: number) => void;
  mouseClick?: (button?: "left" | "right" | "middle", double?: boolean) => void;
  getPixelColor?: (x: number, y: number) => string;
};

const robot = ((robotModule as unknown as { default?: RobotScrollApi }).default ?? robotModule) as unknown as RobotScrollApi;

const performScrollTick = (scrollMouse: NonNullable<RobotScrollApi["scrollMouse"]>) => {
  scrollMouse(0, SCROLL_DELTA_Y);
};

function scrollRuneLiteDownToMaximum() {
  const { scrollMouse } = robot;
  if (typeof scrollMouse !== "function") {
    console.warn("RobotJS scrollMouse is unavailable; skipping Falador startup scroll.");
    return;
  }

  Array.from({ length: SCROLL_TICKS }).forEach(() => performScrollTick(scrollMouse));
}

function moveMouseToRuneLiteCenter(runeLiteWindow: NonNullable<ReturnType<typeof getRuneLite>>) {
  const { moveMouse } = robot;
  if (typeof moveMouse !== "function") {
    return;
  }

  const bounds = runeLiteWindow.getBounds();
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return;
  }

  const centerX = Math.round(x + width / 2);
  const centerY = Math.round(y + height / 2);

  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    return;
  }

  moveMouse(centerX, centerY);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const interval = 100;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += interval;
      if (!AppState.automateBotRunning || elapsed >= ms) {
        clearInterval(id);
        resolve();
      }
    }, interval);
  });
}

function randomIntInclusive(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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

function isGreenPixel(hexColor: string) {
  const rgb = parseHexColor(hexColor);
  if (!rgb) {
    return false;
  }

  if (rgb.g < 150) {
    return false;
  }

  const dominance = rgb.g - Math.max(rgb.r, rgb.b);
  return dominance >= 80;
}

function getRandomOffsetInCircle(radius: number) {
  while (true) {
    const offsetX = randomIntInclusive(-radius, radius);
    const offsetY = randomIntInclusive(-radius, radius);
    if (offsetX * offsetX + offsetY * offsetY <= radius * radius) {
      return { offsetX, offsetY };
    }
  }
}

function safeGetPixelColor(getPixelColor: ((x: number, y: number) => string) | undefined, x: number, y: number) {
  if (typeof getPixelColor !== "function") {
    return null;
  }

  try {
    return getPixelColor(x, y);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("outside the main screen")) {
      return null;
    }

    console.warn(`Falador getPixelColor failed at (${x}, ${y}): ${message}`);
    return null;
  }
}

function getRandomizedClickPoint(point: { x: number; y: number }, getPixelColor?: (x: number, y: number) => string) {
  if (typeof getPixelColor !== "function") {
    const { offsetX, offsetY } = getRandomOffsetInCircle(GREEN_CLICK_RANDOM_OFFSET_PX);
    return {
      x: point.x + offsetX,
      y: point.y + offsetY,
    };
  }

  const centerColor = safeGetPixelColor(getPixelColor, point.x, point.y);
  if (centerColor === null) {
    const { offsetX, offsetY } = getRandomOffsetInCircle(GREEN_CLICK_RANDOM_OFFSET_PX);
    return {
      x: point.x + offsetX,
      y: point.y + offsetY,
    };
  }

  if (!isGreenPixel(centerColor)) {
    return point;
  }

  for (let i = 0; i < GREEN_CLICK_RANDOM_CANDIDATE_ATTEMPTS; i += 1) {
    const { offsetX, offsetY } = getRandomOffsetInCircle(GREEN_CLICK_RANDOM_OFFSET_PX);
    const candidate = {
      x: point.x + offsetX,
      y: point.y + offsetY,
    };

    const candidateColor = safeGetPixelColor(getPixelColor, candidate.x, candidate.y);
    if (candidateColor !== null && isGreenPixel(candidateColor)) {
      return candidate;
    }
  }

  return point;
}

function isNewMarkerPoint(point: { x: number; y: number }) {
  if (lastHandledMarker === null) {
    return true;
  }

  const distance = Math.hypot(point.x - lastHandledMarker.x, point.y - lastHandledMarker.y);
  if (distance >= NEW_MARKER_MIN_MOVE_PX) {
    return true;
  }

  const cooldownElapsed = Date.now() - lastHandledMarker.atMs >= SAME_MARKER_RECLICK_COOLDOWN_MS;
  return cooldownElapsed;
}

async function detectGreenAndClick() {
  const { moveMouse, mouseClick, getPixelColor } = robot;
  if (typeof moveMouse !== "function" || typeof mouseClick !== "function") {
    console.warn("RobotJS move/click API is unavailable; skipping Falador green click.");
    return;
  }

  for (let attempt = 1; attempt <= GREEN_DETECTION_MAX_ATTEMPTS; attempt += 1) {
    if (!AppState.automateBotRunning) {
      return;
    }

    const detection = await detectMarkerState();
    const isGreen = detection.color === "green";
    const point = detection.point;

    if (isGreen && point !== null) {
      if (!isNewMarkerPoint(point)) {
        console.log(`Automate Bot (Falador Roof Top): marker at (${point.x}, ${point.y}) unchanged; waiting for a new marker.`);

        if (attempt < GREEN_DETECTION_MAX_ATTEMPTS) {
          await sleep(GREEN_DETECTION_RETRY_DELAY_MS);
        }
        continue;
      }

      moveMouse(point.x, point.y);
      mouseClick("left", false);
      lastHandledMarker = { x: point.x, y: point.y, atMs: Date.now() };
      console.log(
        `Automate Bot (Falador Roof Top): Step 2 - Green detected at (${point.x}, ${point.y}) and clicked at (${point.x}, ${point.y}), confidence=${detection.confidence}.`,
      );
      return;
    }

    if (attempt < GREEN_DETECTION_MAX_ATTEMPTS) {
      await sleep(GREEN_DETECTION_RETRY_DELAY_MS);
    }
  }

  console.log("Automate Bot (Falador Roof Top): Step 2 - Green marker not detected after scrolling.");
}

function getReducedShapeCoordinate(shape: Coordinate[]): Coordinate | null {
  if (shape.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of shape) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const scale = 0.5;
  const halfWidth = ((maxX - minX) * scale) / 2;
  const halfHeight = ((maxY - minY) * scale) / 2;

  const reducedMinX = centerX - halfWidth;
  const reducedMaxX = centerX + halfWidth;
  const reducedMinY = centerY - halfHeight;
  const reducedMaxY = centerY + halfHeight;

  const reducedShape = shape.filter((point) => {
    return point.x >= reducedMinX && point.x <= reducedMaxX && point.y >= reducedMinY && point.y <= reducedMaxY;
  });

  if (reducedShape.length > 0) {
    const centroid = reducedShape.reduce(
      (acc, point) => {
        acc.x += point.x;
        acc.y += point.y;
        return acc;
      },
      { x: 0, y: 0 },
    );

    centroid.x /= reducedShape.length;
    centroid.y /= reducedShape.length;

    return {
      x: Math.round(centroid.x),
      y: Math.round(centroid.y),
    };
  }

  const p = {
    x: Math.round(centerX),
    y: Math.round(centerY),
  };

  console.log(`Automate Bot (Falador Roof Top): Step 3 - No points in the reduced shape; using shape center (${p.x}, ${p.y}).`);
  return p;
}

function getShapeCenter(shape: Coordinate[]): Coordinate | null {
  if (shape.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of shape) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

const clickNearest = (bounds: { x: number; y: number; width: number; height: number }) => {
  const shapes = findShapes(bounds);

  const searchCenter = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };

  const shape =
    shapes.reduce<Coordinate[]>((closestShape, currentShape) => {
      if (closestShape.length === 0) {
        return currentShape;
      }

      const currentCenter = getShapeCenter(currentShape);
      const closestCenter = getShapeCenter(closestShape);

      if (!currentCenter) {
        return closestShape;
      }

      if (!closestCenter) {
        return currentShape;
      }

      const currentDistance = Math.hypot(currentCenter.x - searchCenter.x, currentCenter.y - searchCenter.y);
      const closestDistance = Math.hypot(closestCenter.x - searchCenter.x, closestCenter.y - searchCenter.y);

      return currentDistance < closestDistance ? currentShape : closestShape;
    }, []) ?? [];

  const point = getReducedShapeCoordinate(shape);
  if (!point) return;

  const clickX = point.x + randomIntInclusive(-5, 5);
  const clickY = point.y + randomIntInclusive(-5, 5);
  moveMouse(clickX, clickY);
  mouseClick("left", false);
};

const findShapes = (bounds: { x: number; y: number; width: number; height: number }) => {
  const greens = findColorShapesInBounds(bounds, { r: 2, g: 255, b: 0 }, { tolerance: 5, minShapeSize: 2, mergeGapPx: 20 }) || [];
  if (!greens.length) {
    const red = findColorShapesInBounds(bounds, { r: 255, g: 2, b: 0 }, { tolerance: 5, minShapeSize: 2, mergeGapPx: 20 }) || [];
    return red;
  }

  return greens;
};

const clickSecondNearest = (bounds: { x: number; y: number; width: number; height: number }) => {
  const shapes = findShapes(bounds);
  const searchCenter = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };

  const sorted = shapes
    .map((s) => ({ shape: s, center: getShapeCenter(s) }))
    .filter((s): s is { shape: Coordinate[]; center: Coordinate } => s.center !== null)
    .sort((a, b) => {
      const da = Math.hypot(a.center.x - searchCenter.x, a.center.y - searchCenter.y);
      const db = Math.hypot(b.center.x - searchCenter.x, b.center.y - searchCenter.y);
      return da - db;
    });

  const shape = sorted[1]?.shape ?? sorted[0]?.shape ?? [];

  const point = getReducedShapeCoordinate(shape);
  if (!point) return;

  const clickX = point.x + randomIntInclusive(-5, 5);
  const clickY = point.y + randomIntInclusive(-5, 5);
  moveMouse(clickX, clickY);
  mouseClick("left", false);
};

const clickFarest = (bounds: { x: number; y: number; width: number; height: number }) => {
  const shapes = findShapes(bounds);

  const searchCenter = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };

  const shape =
    shapes.reduce<Coordinate[]>((farthestShape, currentShape) => {
      if (farthestShape.length === 0) {
        return currentShape;
      }

      const currentCenter = getShapeCenter(currentShape);
      const farthestCenter = getShapeCenter(farthestShape);

      if (!currentCenter) {
        return farthestShape;
      }

      if (!farthestCenter) {
        return currentShape;
      }

      const currentDistance = Math.hypot(currentCenter.x - searchCenter.x, currentCenter.y - searchCenter.y);
      const farthestDistance = Math.hypot(farthestCenter.x - searchCenter.x, farthestCenter.y - searchCenter.y);

      return currentDistance > farthestDistance ? currentShape : farthestShape;
    }, []) ?? [];

  const point = getReducedShapeCoordinate(shape);
  if (!point) return;

  const clickX = point.x + randomIntInclusive(-5, 5);
  const clickY = point.y + randomIntInclusive(-5, 5);
  moveMouse(clickX, clickY);
  mouseClick("left", false);
};

async function runFaladorLoop(window: Window) {
  if (isFaladorLoopRunning) {
    console.log("Automate Bot (Falador Roof Top): loop already running; skipping new start.");
    return;
  }
  const windowBounds = window.getBounds();
  const bounds = {
    x: Number(windowBounds.x),
    y: Number(windowBounds.y),
    width: Number(windowBounds.width) - 550,
    height: Number(windowBounds.height) - 50,
  };

  // Step 1
  setAutomateBotCurrentStep("falador-rooftop-step-1");
  console.log("Falador Step 1");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 2 - Tightrope
  setAutomateBotCurrentStep("falador-rooftop-step-2");
  console.log("Falador Step 2 - Tightrope");
  clickNearest(bounds);
  await sleep(8000);
  if (!AppState.automateBotRunning) return;

  // Step 3 - Hands Hold
  setAutomateBotCurrentStep("falador-rooftop-step-3");
  console.log("Falador Step 3 - Hands Hold");
  clickSecondNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 4 - Gap
  setAutomateBotCurrentStep("falador-rooftop-step-4");
  console.log("Falador Step 4 - Gap");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 5 - Gap
  setAutomateBotCurrentStep("falador-rooftop-step-5");
  console.log("Falador Step 5 - Gap");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 6 - Tightrope
  setAutomateBotCurrentStep("falador-rooftop-step-6");
  console.log("Falador Step 6 - Tightrope");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 7 - Tightrope
  setAutomateBotCurrentStep("falador-rooftop-step-7");
  console.log("Falador Step 7 - Tightrope");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 8 - Gap
  setAutomateBotCurrentStep("falador-rooftop-step-8");
  console.log("Falador Step 8 - Gap");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 9 - Ledge
  setAutomateBotCurrentStep("falador-rooftop-step-9");
  console.log("Falador Step 9 - Ledge");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 10 - Ledge
  setAutomateBotCurrentStep("falador-rooftop-step-10");
  console.log("Falador Step 10 - Ledge");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 11 - Ledge
  setAutomateBotCurrentStep("falador-rooftop-step-11");
  console.log("Falador Step 11 - Ledge");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 12 - Ledge
  setAutomateBotCurrentStep("falador-rooftop-step-12");
  console.log("Falador Step 12 - Ledge");
  clickNearest(bounds);
  await sleep(7000);
  if (!AppState.automateBotRunning) return;

  // Step 13 - Ledge
  setAutomateBotCurrentStep("falador-rooftop-step-13");
  console.log("Falador Step 13 - Ledge");
  clickNearest(bounds);
  setAutomateBotCurrentStep(null);
}

export function onFaladorRooftopStart() {
  const window = getRuneLite();
  if (!window) return;

  const maybeMinimizedWindow = window as unknown as { isMinimized?: () => boolean; restore: () => void };
  if (typeof maybeMinimizedWindow.isMinimized === "function" && maybeMinimizedWindow.isMinimized()) {
    maybeMinimizedWindow.restore();
  }

  window.bringToTop();
  moveMouseToRuneLiteCenter(window);
  lastHandledMarker = null;
  console.log("Automate Bot STARTED (Falador Roof Top).");
  void runFaladorLoop(window);
}
