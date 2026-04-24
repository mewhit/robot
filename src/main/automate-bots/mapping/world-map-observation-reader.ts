import { detectOverlayBoxInScreenshot } from "../shared/coordinate-box-detector";
import { RobotBitmap } from "../shared/ocr-engine";
import { WorldMapObservation } from "./async-world-mapper";
import { parseWorldTileFromMatchedLine } from "./world-coordinate";

const OVERLAY_OBSERVATION_CONFIDENCE = 0.65;

export function readWorldMapObservationFromBitmap(params: {
  bitmap: RobotBitmap;
  observedAtMs: number;
  windowsScalePercent: number;
}): Omit<WorldMapObservation, "sessionId" | "botId"> | null {
  const overlayBox = detectOverlayBoxInScreenshot(params.bitmap, params.windowsScalePercent);
  if (!overlayBox) {
    return null;
  }

  const tile = parseWorldTileFromMatchedLine(overlayBox.matchedLine);
  if (!tile) {
    return null;
  }

  return {
    observedAtMs: params.observedAtMs,
    source: "overlay",
    confidence: OVERLAY_OBSERVATION_CONFIDENCE,
    matchedLine: overlayBox.matchedLine,
    tile,
    coordinateBox: {
      x: overlayBox.x,
      y: overlayBox.y,
      width: overlayBox.width,
      height: overlayBox.height,
    },
    coordinateBoxScreenshotPath: null,
  };
}
