import { MotherlodeMineBox } from "./motherlode-mine-box-detector";

type CaptureSize = {
  width: number;
  height: number;
};

type AnchorPoint = {
  x: number;
  y: number;
};

export function selectNearestGreenMotherlodeNode(
  greenBoxes: MotherlodeMineBox[],
  captureSize: CaptureSize,
  playerAnchorInCapture: AnchorPoint | null,
): MotherlodeMineBox | null {
  if (greenBoxes.length === 0) {
    return null;
  }

  // Prefer the detected magenta player marker. Fallback to center only when unavailable.
  const anchorX = playerAnchorInCapture?.x ?? captureSize.width / 2;
  const anchorY = playerAnchorInCapture?.y ?? captureSize.height / 2;

  let best: MotherlodeMineBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const box of greenBoxes) {
    const dx = box.centerX - anchorX;
    const dy = box.centerY - anchorY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = box;
      continue;
    }

    // Keep detector confidence as a tiebreaker when distances are effectively equal.
    if (best && Math.abs(distance - bestDistance) < 0.5 && box.score > best.score) {
      best = box;
    }
  }

  return best;
}
