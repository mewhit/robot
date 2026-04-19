import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  detectMotherlodeMineBoxesInScreenshot,
  saveBitmapWithMotherlodeMineBoxes,
} from "./motherlode-mine-box-detector";

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

type ExpectedBoxCounts = {
  green: number;
  yellow: number;
};

function parseExpectedColorCountsFromFilename(screenshotPath: string): ExpectedBoxCounts | null {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const match = basename.match(/-g(\d+)-y(\d+)(?:-nodes)?$/i);
  if (!match) {
    return null;
  }

  const expectedGreenCount = Number(match[1]);
  const expectedYellowCount = Number(match[2]);
  if (!Number.isFinite(expectedGreenCount) || !Number.isFinite(expectedYellowCount)) {
    return null;
  }

  return {
    green: expectedGreenCount,
    yellow: expectedYellowCount,
  };
}

function parseExpectedNodeCountFromFilename(screenshotPath: string): number | null {
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const match = basename.match(/-(\d+)-nodes$/i);
  if (!match) {
    return null;
  }

  const expectedCount = Number(match[1]);
  return Number.isFinite(expectedCount) ? expectedCount : null;
}

async function testDetection(screenshotPath: string): Promise<boolean> {
  console.log(`\nTesting: ${screenshotPath}`);
  console.log("-".repeat(60));

  const bitmap = await loadScreenshot(screenshotPath);
  if (!bitmap) {
    return false;
  }

  const boxes = detectMotherlodeMineBoxesInScreenshot(bitmap);
  const greenBoxes = boxes.filter((box) => box.color === "green");
  const yellowBoxes = boxes.filter((box) => box.color === "yellow");
  const expectedColorCounts = parseExpectedColorCountsFromFilename(screenshotPath);
  const expectedNodeCount = parseExpectedNodeCountFromFilename(screenshotPath);

  if (boxes.length === 0) {
    console.log("No motherlode mine boxes detected.");
  }

  for (const [index, box] of boxes.entries()) {
    console.log(
      `#${index + 1} motherlode-box at (${box.x}, ${box.y}) ${box.width}x${box.height} center=(${box.centerX}, ${box.centerY}) pixels=${box.pixelCount} fill=${box.fillRatio.toFixed(3)} green-dominance=${box.greenDominance.toFixed(1)} score=${box.score.toFixed(1)}`,
    );
  }

  const debugOutputDir = "./test-image-debug";
  const basename = path.basename(screenshotPath, path.extname(screenshotPath));
  const debugPath = path.join(debugOutputDir, `${basename}-motherlode-mine-boxes.png`);
  saveBitmapWithMotherlodeMineBoxes(bitmap, boxes, debugPath);
  console.log(`Debug image: ${debugPath}`);

  if (expectedColorCounts !== null) {
    if (greenBoxes.length !== expectedColorCounts.green || yellowBoxes.length !== expectedColorCounts.yellow) {
      console.error(
        `FAILED: Expected counts from filename suffix '-g${expectedColorCounts.green}-y${expectedColorCounts.yellow}': green=${expectedColorCounts.green}, yellow=${expectedColorCounts.yellow}; detected green=${greenBoxes.length}, yellow=${yellowBoxes.length}.`,
      );
      return false;
    }

    console.log(
      `Color count assertion passed: expected g=${expectedColorCounts.green}, y=${expectedColorCounts.yellow}; detected g=${greenBoxes.length}, y=${yellowBoxes.length}.`,
    );
    return true;
  }

  if (expectedNodeCount !== null) {
    if (boxes.length !== expectedNodeCount) {
      console.error(
        `FAILED: Expected ${expectedNodeCount} node(s) from filename suffix '-${expectedNodeCount}-nodes', but detected ${boxes.length}.`,
      );
      return false;
    }

    console.log(`Node count assertion passed: expected ${expectedNodeCount}, detected ${boxes.length}.`);
    return true;
  }

  if (boxes.length === 0) {
    return false;
  }

  console.log("No '-gN-yN' or '-N-nodes' suffix in filename; skipping count assertions.");

  return true;
}

async function main(): Promise<void> {
  const args = expandScreenshotArgs(process.argv.slice(2));
  const screenshots = args.length > 0 ? args : ["test-images/motherlode-mine-box/*.png"];
  const expandedScreenshots = expandScreenshotArgs(screenshots);

  console.log(`\nMotherlode Mine Box Detector Test Suite`);
  console.log(`Testing ${expandedScreenshots.length} screenshot(s)...`);

  let successCount = 0;
  let failureCount = 0;

  for (const screenshotPath of expandedScreenshots) {
    const success = await testDetection(screenshotPath);
    if (success) {
      successCount += 1;
    } else {
      failureCount += 1;
    }
  }

  console.log(`\nResults: ${successCount} passed, ${failureCount} failed`);

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch(console.error);
