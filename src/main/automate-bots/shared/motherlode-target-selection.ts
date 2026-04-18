import { MotherlodeMineBox } from "./motherlode-mine-box-detector";

type CaptureSize = {
  width: number;
  height: number;
};

type AnchorPoint = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function distanceToBox(anchorX: number, anchorY: number, box: MotherlodeMineBox): { edge: number; center: number } {
  const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
  const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
  const edgeDx = anchorX - nearestX;
  const edgeDy = anchorY - nearestY;
  const edgeDistance = axisDistance(edgeDx, edgeDy);

  const centerDx = anchorX - box.centerX;
  const centerDy = anchorY - box.centerY;
  const centerDistance = axisDistance(centerDx, centerDy);

  return { edge: edgeDistance, center: centerDistance };
}

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
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of greenBoxes) {
    const distance = distanceToBox(anchorX, anchorY, box);

    if (distance.edge < bestEdgeDistance) {
      bestEdgeDistance = distance.edge;
      bestCenterDistance = distance.center;
      best = box;
      continue;
    }

    if (!best || Math.abs(distance.edge - bestEdgeDistance) >= 0.5) {
      continue;
    }

    if (distance.center < bestCenterDistance) {
      bestCenterDistance = distance.center;
      best = box;
      continue;
    }

    // Keep detector confidence as the final tiebreaker.
    if (Math.abs(distance.center - bestCenterDistance) < 0.5 && box.score > best.score) {
      bestCenterDistance = distance.center;
      best = box;
    }
  }

  return best;
}
