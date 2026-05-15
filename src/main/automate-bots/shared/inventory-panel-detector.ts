import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";
import { clamp } from "./osrs-helper";

export type InventoryPanelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type InventoryPanelSlot = InventoryPanelBox & {
  slot: number;
  row: number;
  col: number;
  centerX: number;
  centerY: number;
};

export type InventoryPanelDetection = {
  panelBox: InventoryPanelBox;
  inventoryBox: InventoryPanelBox;
  slots: InventoryPanelSlot[];
  scalePercent: number;
  rightReservedWidthLogical: number;
  source: "runelite-fixed-ui-geometry";
};

export type InventoryPanelTargetSlot = {
  slot: number;
  label?: string;
};

export type InventoryPanelDebugPoint = {
  x: number;
  y: number;
  label?: string;
};

export type InventoryPanelDebugBox = InventoryPanelBox & {
  label?: string;
};

const INVENTORY_COLUMNS = 4;
const INVENTORY_ROWS = 7;
const REFERENCE_LARGE_CAPTURE_HEIGHT = 1549;

const PANEL_WIDTH_LOGICAL = 245;
const PANEL_HEIGHT_LOGICAL = 312;
const PANEL_RIGHT_MARGIN_LOGICAL = 50;
const PANEL_BOTTOM_MARGIN_LOGICAL = 31;

const FIRST_SLOT_CENTER_X_LOGICAL = 62;
const FIRST_SLOT_CENTER_Y_LOGICAL = 58;
const SLOT_WIDTH_LOGICAL = 36;
const SLOT_HEIGHT_LOGICAL = 32;
const SLOT_STEP_X_LOGICAL = 42;
const SLOT_STEP_Y_LOGICAL = 36;

function estimateInventoryUiScalePercent(bitmap: RobotBitmap, scalePercentHint?: number): number {
  if (scalePercentHint && Number.isFinite(scalePercentHint) && scalePercentHint >= 80 && scalePercentHint <= 250) {
    return Math.round(scalePercentHint);
  }

  // The bot's tested 2k captures are 125% DPI. Large 4k debug captures in the repo are 100% DPI.
  return bitmap.height >= Math.round(REFERENCE_LARGE_CAPTURE_HEIGHT * 1.2) ? 100 : 125;
}

function scaled(logicalPx: number, scale: number): number {
  return Math.max(1, Math.round(logicalPx * scale));
}

function clampBox(bitmap: RobotBitmap, box: InventoryPanelBox): InventoryPanelBox {
  const x = clamp(Math.round(box.x), 0, Math.max(0, bitmap.width - 1));
  const y = clamp(Math.round(box.y), 0, Math.max(0, bitmap.height - 1));
  const width = clamp(Math.round(box.width), 1, Math.max(1, bitmap.width - x));
  const height = clamp(Math.round(box.height), 1, Math.max(1, bitmap.height - y));
  return { x, y, width, height };
}

export function detectInventoryPanelInScreenshot(
  bitmap: RobotBitmap,
  options: { scalePercentHint?: number; rightReservedWidthLogical?: number } = {},
): InventoryPanelDetection {
  const scalePercent = estimateInventoryUiScalePercent(bitmap, options.scalePercentHint);
  const scale = scalePercent / 100;
  const rightReservedWidthLogical = Math.max(0, options.rightReservedWidthLogical ?? 0);

  const panelWidth = scaled(PANEL_WIDTH_LOGICAL, scale);
  const panelHeight = scaled(PANEL_HEIGHT_LOGICAL, scale);
  const rightMargin = scaled(PANEL_RIGHT_MARGIN_LOGICAL, scale);
  const rightReservedWidth = Math.round(rightReservedWidthLogical * scale);
  const bottomMargin = scaled(PANEL_BOTTOM_MARGIN_LOGICAL, scale);
  const panelBox = clampBox(bitmap, {
    x: bitmap.width - rightReservedWidth - rightMargin - panelWidth,
    y: bitmap.height - bottomMargin - panelHeight,
    width: panelWidth,
    height: panelHeight,
  });

  const slotWidth = scaled(SLOT_WIDTH_LOGICAL, scale);
  const slotHeight = scaled(SLOT_HEIGHT_LOGICAL, scale);
  const slotStepX = scaled(SLOT_STEP_X_LOGICAL, scale);
  const slotStepY = scaled(SLOT_STEP_Y_LOGICAL, scale);
  const firstCenterX = panelBox.x + scaled(FIRST_SLOT_CENTER_X_LOGICAL, scale);
  const firstCenterY = panelBox.y + scaled(FIRST_SLOT_CENTER_Y_LOGICAL, scale);

  const slots: InventoryPanelSlot[] = [];
  for (let row = 0; row < INVENTORY_ROWS; row += 1) {
    for (let col = 0; col < INVENTORY_COLUMNS; col += 1) {
      const slot = row * INVENTORY_COLUMNS + col;
      const centerX = firstCenterX + col * slotStepX;
      const centerY = firstCenterY + row * slotStepY;
      const box = clampBox(bitmap, {
        x: centerX - Math.floor(slotWidth / 2),
        y: centerY - Math.floor(slotHeight / 2),
        width: slotWidth,
        height: slotHeight,
      });
      slots.push({
        ...box,
        slot,
        row,
        col,
        centerX: box.x + Math.round(box.width / 2),
        centerY: box.y + Math.round(box.height / 2),
      });
    }
  }

  const firstSlot = slots[0];
  const lastSlot = slots[slots.length - 1];
  const inventoryBox = clampBox(bitmap, {
    x: firstSlot.x,
    y: firstSlot.y,
    width: lastSlot.x + lastSlot.width - firstSlot.x,
    height: lastSlot.y + lastSlot.height - firstSlot.y,
  });

  return {
    panelBox,
    inventoryBox,
    slots,
    scalePercent,
    rightReservedWidthLogical,
    source: "runelite-fixed-ui-geometry",
  };
}

export function getInventoryPanelSlot(detection: InventoryPanelDetection, slot: number): InventoryPanelSlot | null {
  return detection.slots.find((entry) => entry.slot === slot) ?? null;
}

function setPngPixel(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }

  const idx = (y * png.width + x) * 4;
  png.data[idx] = color.r;
  png.data[idx + 1] = color.g;
  png.data[idx + 2] = color.b;
  png.data[idx + 3] = 255;
}

function drawBox(
  png: PNG,
  box: InventoryPanelBox,
  color: { r: number; g: number; b: number },
  thickness = 2,
): void {
  const x0 = clamp(Math.round(box.x), 0, png.width - 1);
  const y0 = clamp(Math.round(box.y), 0, png.height - 1);
  const x1 = clamp(Math.round(box.x + box.width - 1), 0, png.width - 1);
  const y1 = clamp(Math.round(box.y + box.height - 1), 0, png.height - 1);

  for (let t = 0; t < thickness; t += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPngPixel(png, x, y0 + t, color);
      setPngPixel(png, x, y1 - t, color);
    }
    for (let y = y0; y <= y1; y += 1) {
      setPngPixel(png, x0 + t, y, color);
      setPngPixel(png, x1 - t, y, color);
    }
  }
}

function drawCross(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }, radius = 5): void {
  for (let delta = -radius; delta <= radius; delta += 1) {
    setPngPixel(png, x + delta, y, color);
    setPngPixel(png, x, y + delta, color);
  }
}

function bitmapToPng(bitmap: RobotBitmap): PNG {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const sourceOffset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const targetOffset = (y * bitmap.width + x) * 4;
      png.data[targetOffset] = bitmap.image[sourceOffset + 2];
      png.data[targetOffset + 1] = bitmap.image[sourceOffset + 1];
      png.data[targetOffset + 2] = bitmap.image[sourceOffset];
      png.data[targetOffset + 3] = bitmap.image[sourceOffset + 3] ?? 255;
    }
  }
  return png;
}

function ensureParentDirectory(filename: string): void {
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writePngToFile(png: PNG, filename: string): Promise<void> {
  ensureParentDirectory(filename);
  return new Promise((resolve, reject) => {
    png.pack().pipe(fs.createWriteStream(filename)).on("finish", resolve).on("error", reject);
  });
}

export async function saveBitmapWithInventoryPanelDebug(
  bitmap: RobotBitmap,
  detection: InventoryPanelDetection,
  outputPath: string,
  options: {
    targetSlots?: readonly InventoryPanelTargetSlot[];
    debugPoints?: readonly InventoryPanelDebugPoint[];
    debugBoxes?: readonly InventoryPanelDebugBox[];
  } = {},
): Promise<void> {
  const png = bitmapToPng(bitmap);
  const targetSlots = new Set((options.targetSlots ?? []).map((target) => target.slot));

  drawBox(png, detection.panelBox, { r: 255, g: 220, b: 0 }, 4);
  drawBox(png, detection.inventoryBox, { r: 0, g: 220, b: 255 }, 3);

  for (const slot of detection.slots) {
    const isTarget = targetSlots.has(slot.slot);
    drawBox(png, slot, isTarget ? { r: 255, g: 40, b: 40 } : { r: 110, g: 220, b: 255 }, isTarget ? 4 : 1);
    if (isTarget) {
      drawCross(png, slot.centerX, slot.centerY, { r: 255, g: 40, b: 40 }, 7);
    }
  }

  for (const point of options.debugPoints ?? []) {
    drawCross(png, Math.round(point.x), Math.round(point.y), { r: 255, g: 0, b: 255 }, 10);
  }

  for (const box of options.debugBoxes ?? []) {
    drawBox(png, box, { r: 255, g: 0, b: 255 }, 3);
  }

  await writePngToFile(png, outputPath);
}

export function formatInventoryPanelDetection(detection: InventoryPanelDetection): string {
  return `source=${detection.source} scale=${detection.scalePercent}% rightReserved=${detection.rightReservedWidthLogical}logical panel=${detection.panelBox.x},${detection.panelBox.y},${detection.panelBox.width}x${detection.panelBox.height} inventory=${detection.inventoryBox.x},${detection.inventoryBox.y},${detection.inventoryBox.width}x${detection.inventoryBox.height} slots=${detection.slots.length}`;
}
