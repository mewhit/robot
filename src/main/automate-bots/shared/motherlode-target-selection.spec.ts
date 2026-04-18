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

function isSameBox(a: MotherlodeMineBox | null, b: MotherlodeMineBox | null): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function findStrictNearest(
  greenBoxes: MotherlodeMineBox[],
  anchor: AnchorPoint,
): { box: MotherlodeMineBox | null; distance: number } {
  let best: MotherlodeMineBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const box of greenBoxes) {
    const boxDistance = distance({ x: box.centerX, y: box.centerY }, anchor);

    if (boxDistance < bestDistance) {
      bestDistance = boxDistance;
      best = box;
      continue;
    }

    if (best && Math.abs(boxDistance - bestDistance) < 0.5 && box.score > best.score) {
      best = box;
    }
  }

  return { box: best, distance: bestDistance };
}

async function main(): Promise<void> {
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
  const expected = findStrictNearest(greenBoxes, playerAnchor);

  if (!selectedByAlgo) {
    console.error("FAILED: Algo returned no selected node.");
    process.exit(1);
  }

  if (!expected.box) {
    console.error("FAILED: Could not compute expected nearest node.");
    process.exit(1);
  }

  const algoDistance = distance({ x: selectedByAlgo.centerX, y: selectedByAlgo.centerY }, playerAnchor);
  const centerDistance = selectedByCenterFallback
    ? distance({ x: selectedByCenterFallback.centerX, y: selectedByCenterFallback.centerY }, playerAnchor)
    : Number.POSITIVE_INFINITY;

  console.log(`Player anchor center: (${playerAnchor.x}, ${playerAnchor.y})`);
  console.log(`Detected green nodes: ${greenBoxes.length}`);
  console.log(
    `Algo selected node center=(${selectedByAlgo.centerX}, ${selectedByAlgo.centerY}) distance-to-player=${algoDistance.toFixed(2)}`,
  );
  console.log(
    `Expected nearest center=(${expected.box.centerX}, ${expected.box.centerY}) distance-to-player=${expected.distance.toFixed(2)}`,
  );

  if (!isSameBox(selectedByAlgo, expected.box)) {
    console.error("FAILED: Algo did not pick the nearest green node to magenta player anchor.");
    process.exit(1);
  }

  if (selectedByCenterFallback && !isSameBox(selectedByAlgo, selectedByCenterFallback)) {
    console.log(
      `Center-only fallback would select (${selectedByCenterFallback.centerX}, ${selectedByCenterFallback.centerY}) distance-to-player=${centerDistance.toFixed(2)}`,
    );
  }

  console.log("PASS: Algo selected the nearest green node to magenta player anchor.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
