import {
  detectInventoryCount,
  saveBitmapWithInventoryCountDebug,
  type InventoryCountResult,
} from "./inventory-count-detector";
import type { RobotBitmap } from "./ocr-engine";

export type InventoryFreeSpaceResult = InventoryCountResult & {
  freeSlots: number | null;
};

export function detectInventoryFreeSpace(bitmap: RobotBitmap): InventoryFreeSpaceResult {
  const result = detectInventoryCount(bitmap);
  return {
    ...result,
    freeSlots: result.count,
  };
}

export function saveBitmapWithInventoryFreeSpaceDebug(
  bitmap: RobotBitmap,
  result: InventoryFreeSpaceResult | InventoryCountResult,
  outputPath: string,
): void {
  saveBitmapWithInventoryCountDebug(bitmap, result, outputPath);
}
