import fs from "fs";
import { PNG } from "pngjs";
import { detectMotherlodeMineBoxesInScreenshot, MotherlodeMineBox } from "./motherlode-mine-box-detector";
import { detectBestPlayerBoxInScreenshot } from "./player-box-detector";
import { selectNearestGreenMotherlodeNode } from "./motherlode-target-selection";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type AnchorPoint = {
  x: number;
  y: number;
};

async function loadScreenshot(filePath: string): Promise<RobotBitmap | null> {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return null;
  }

  return new Promise((resolve) => {
    const png = new PNG();

    fs.createReadStream(filePath)
      .pipe(png)
      .on("parsed", function (this: PNG) {
        const buffer = Buffer.alloc(png.width * png.height * 4);

        for (let index = 0; index < png.data.length; index += 4) {
          const r = png.data[index];
          const g = png.data[index + 1];
          const b = png.data[index + 2];

          buffer[index] = b;
          buffer[index + 1] = g;
          buffer[index + 2] = r;
          buffer[index + 3] = 255;
        }

        resolve({
          width: png.width,
          height: png.height,
          byteWidth: png.width * 4,
          bytesPerPixel: 4,
          image: buffer,
        });
      })
      .on("error", (error) => {
        console.error(`Failed to load image: ${error}`);
        resolve(null);
      });
  });
}

function distance(a: AnchorPoint, b: AnchorPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function distanceToBox(anchor: AnchorPoint, box: MotherlodeMineBox): { edge: number; center: number } {
  const nearestX = clamp(anchor.x, box.x, box.x + box.width - 1);
  const nearestY = clamp(anchor.y, box.y, box.y + box.height - 1);
  const edgeDx = anchor.x - nearestX;
  const edgeDy = anchor.y - nearestY;
  const edgeDistance = axisDistance(edgeDx, edgeDy);
  const centerDx = anchor.x - box.centerX;
  const centerDy = anchor.y - box.centerY;
  const centerDistance = axisDistance(centerDx, centerDy);

  return {
    edge: edgeDistance,
    center: centerDistance,
  };
}

function isSameBox(a: MotherlodeMineBox | null, b: MotherlodeMineBox | null): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function findStrictNearestByProximity(
  greenBoxes: MotherlodeMineBox[],
  anchor: AnchorPoint,
): { box: MotherlodeMineBox | null; edgeDistance: number; centerDistance: number } {
  let best: MotherlodeMineBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of greenBoxes) {
    const boxDistance = distanceToBox(anchor, box);

    if (boxDistance.edge < bestEdgeDistance) {
      bestEdgeDistance = boxDistance.edge;
      bestCenterDistance = boxDistance.center;
      best = box;
      continue;
    }

    if (!best || Math.abs(boxDistance.edge - bestEdgeDistance) >= 0.5) {
      continue;
    }

    if (boxDistance.center < bestCenterDistance) {
      bestCenterDistance = boxDistance.center;
      best = box;
      continue;
    }

    if (Math.abs(boxDistance.center - bestCenterDistance) < 0.5 && box.score > best.score) {
      bestCenterDistance = boxDistance.center;
      best = box;
    }
  }

  return { box: best, edgeDistance: bestEdgeDistance, centerDistance: bestCenterDistance };
}

function makeSyntheticBox(x: number, y: number, width: number, height: number, score: number): MotherlodeMineBox {
  const centerX = x + Math.round((width - 1) / 2);
  const centerY = y + Math.round((height - 1) / 2);

  return {
    x,
    y,
    width,
    height,
    centerX,
    centerY,
    pixelCount: width * height,
    fillRatio: 0.55,
    aspectRatio: width / height,
    avgRed: 70,
    avgGreen: 180,
    avgBlue: 70,
    greenDominance: 110,
    score,
    color: "green",
  };
}

function runSyntheticProximityRegression(): boolean {
  console.log("\nSynthetic proximity regression (crowded cluster)");
  console.log("-".repeat(60));

  const captureSize = { width: 220, height: 180 };
  const anchor: AnchorPoint = { x: 100, y: 100 };
  const edgeCloserLargeNode = makeSyntheticBox(108, 84, 64, 64, 45);
  const centerCloserSmallNode = makeSyntheticBox(76, 76, 16, 16, 90);
  const greenBoxes = [centerCloserSmallNode, edgeCloserLargeNode];

  const selectedByAlgo = selectNearestGreenMotherlodeNode(greenBoxes, captureSize, anchor);
  const expected = findStrictNearestByProximity(greenBoxes, anchor);

  if (!selectedByAlgo || !expected.box) {
    console.error("FAILED: Synthetic regression could not compute selected or expected node.");
    return false;
  }

  const selectedDistance = distanceToBox(anchor, selectedByAlgo);
  const expectedDistance = distanceToBox(anchor, expected.box);
  const centerCloserDistance = distanceToBox(anchor, centerCloserSmallNode);

  console.log(
    `Anchor=(${anchor.x}, ${anchor.y}) edge-nearest expected center=(${edgeCloserLargeNode.centerX}, ${edgeCloserLargeNode.centerY}) edge=${expectedDistance.edge.toFixed(2)} center=${expectedDistance.center.toFixed(2)}`,
  );
  console.log(
    `Center-nearest distractor center=(${centerCloserSmallNode.centerX}, ${centerCloserSmallNode.centerY}) edge=${centerCloserDistance.edge.toFixed(2)} center=${centerCloserDistance.center.toFixed(2)}`,
  );
  console.log(
    `Algo selected center=(${selectedByAlgo.centerX}, ${selectedByAlgo.centerY}) edge=${selectedDistance.edge.toFixed(2)} center=${selectedDistance.center.toFixed(2)}`,
  );

  if (!isSameBox(expected.box, edgeCloserLargeNode)) {
    console.error(
      "FAILED: Synthetic setup invalid; expected nearest-by-proximity box was not the intended edge-nearest node.",
    );
    return false;
  }

  if (!isSameBox(selectedByAlgo, expected.box)) {
    console.error("FAILED: Algo did not select the nearest box by proximity in synthetic crowded-cluster case.");
    return false;
  }

  console.log("PASS: Synthetic crowded-cluster proximity regression passed.");
  return true;
}

async function main(): Promise<void> {
  const syntheticPassed = runSyntheticProximityRegression();
  if (!syntheticPassed) {
    process.exit(1);
  }

  const screenshotPath = process.argv[2] ?? "image-test/motherlode-nearest-anchor.png";
  console.log(`\nMotherlode Target Selection Test`);
  console.log(`Screenshot: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    process.exit(1);
  }

  const boxes = detectMotherlodeMineBoxesInScreenshot(bitmap);
  const greenBoxes = boxes.filter((b) => b.color === "green");
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);

  if (!playerBox) {
    console.error("FAILED: Could not detect magenta player anchor in screenshot.");
    process.exit(1);
  }

  if (greenBoxes.length === 0) {
    console.error("FAILED: Could not detect any green motherlode nodes in screenshot.");
    process.exit(1);
  }

  const playerAnchor = { x: playerBox.centerX, y: playerBox.centerY };
  const captureSize = { width: bitmap.width, height: bitmap.height };

  const selectedByAlgo = selectNearestGreenMotherlodeNode(greenBoxes, captureSize, playerAnchor);
  const selectedByCenterFallback = selectNearestGreenMotherlodeNode(greenBoxes, captureSize, null);
  const expected = findStrictNearestByProximity(greenBoxes, playerAnchor);

  if (!selectedByAlgo) {
    console.error("FAILED: Algo returned no selected node.");
    process.exit(1);
  }

  if (!expected.box) {
    console.error("FAILED: Could not compute expected nearest node.");
    process.exit(1);
  }

  const algoDistance = distanceToBox(playerAnchor, selectedByAlgo);
  const centerFallbackDistance = selectedByCenterFallback
    ? distanceToBox(playerAnchor, selectedByCenterFallback)
    : null;
  const expectedDistance = distanceToBox(playerAnchor, expected.box);

  console.log(`Player anchor center: (${playerAnchor.x}, ${playerAnchor.y})`);
  console.log(`Detected green nodes: ${greenBoxes.length}`);
  console.log(
    `Algo selected node center=(${selectedByAlgo.centerX}, ${selectedByAlgo.centerY}) proximity-to-player=${algoDistance.edge.toFixed(2)} center-distance=${algoDistance.center.toFixed(2)}`,
  );
  console.log(
    `Expected nearest center=(${expected.box.centerX}, ${expected.box.centerY}) proximity-to-player=${expectedDistance.edge.toFixed(2)} center-distance=${expectedDistance.center.toFixed(2)}`,
  );

  if (!isSameBox(selectedByAlgo, expected.box)) {
    console.error("FAILED: Algo did not pick the nearest green node by proximity to magenta player anchor.");
    process.exit(1);
  }

  if (selectedByCenterFallback && centerFallbackDistance && !isSameBox(selectedByAlgo, selectedByCenterFallback)) {
    console.log(
      `Center-only fallback would select (${selectedByCenterFallback.centerX}, ${selectedByCenterFallback.centerY}) proximity-to-player=${centerFallbackDistance.edge.toFixed(2)} center-distance=${centerFallbackDistance.center.toFixed(2)}`,
    );
  }

  console.log("PASS: Algo selected the nearest green node by proximity to magenta player anchor.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
