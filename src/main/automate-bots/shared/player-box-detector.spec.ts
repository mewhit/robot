import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { detectPlayerBoxesInScreenshot, saveBitmapWithPlayerBoxes } from "./player-box-detector";

type RobotBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
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

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function expandScreenshotArgs(args: string[]): string[] {
  const expanded: string[] = [];

  for (const arg of args) {
    if (!arg.includes("*")) {
      expanded.push(arg);
      continue;
    }

    const normalized = arg.replace(/\\/g, "/");
    const slashIndex = normalized.lastIndexOf("/");
    const dir = slashIndex >= 0 ? normalized.slice(0, slashIndex) : ".";
    const filePattern = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
    const patternRegex = patternToRegex(filePattern);

    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      expanded.push(arg);
      continue;
    }

    const matches = fs
      .readdirSync(dir)
      .filter((entry) => patternRegex.test(entry))
      .map((entry) => path.join(dir, entry));

    if (matches.length === 0) {
      expanded.push(arg);
      continue;
    }

    expanded.push(...matches);
  }

  return expanded;
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    console.log("FAILED: Could not load screenshot");
    return false;
  }

  const boxes = detectPlayerBoxesInScreenshot(bitmap);

  console.log(`Found ${boxes.length} player box(es)`);
  for (const box of boxes) {
    console.log(
      `  - Position: (${box.x}, ${box.y}), Size: ${box.width}x${box.height}, Center: (${box.centerX}, ${box.centerY})`,
    );
    console.log(
      `    Pixels: ${box.pixelCount}, Fill: ${(box.fillRatio * 100).toFixed(1)}%, Score: ${box.score.toFixed(1)}`,
    );
  }

  if (boxes.length > 0) {
    const outputPath = path.join(
      "ocr-debug",
      path.basename(screenshotPath, path.extname(screenshotPath)) + "-player.png",
    );
    await saveBitmapWithPlayerBoxes(bitmap, boxes, outputPath);
    console.log(`Output saved to: ${outputPath}`);
    return true;
  } else {
    console.log("WARNING: No player boxes detected");
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const expandedArgs = expandScreenshotArgs(args);

  if (expandedArgs.length === 0) {
    console.error("Usage: ts-node player-box-detector.spec.ts <screenshot-path> [<screenshot-path> ...]");
    process.exit(1);
  }

  let successCount = 0;
  let totalCount = 0;

  for (const screenshotPath of expandedArgs) {
    totalCount += 1;
    const success = await testDetection(screenshotPath);
    if (success) {
      successCount += 1;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${successCount}/${totalCount} tests detected player boxes`);
  console.log("=".repeat(60));

  process.exit(successCount === totalCount ? 0 : 1);
}

main();
