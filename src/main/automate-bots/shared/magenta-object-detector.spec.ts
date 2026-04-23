#!/usr/bin/env node
/**
 * magenta-object-detector.spec.ts
 *
 * Usage:
 *   node -r ts-node/register magenta-object-detector.spec.ts <glob-or-path...>
 *
 * Runs the magenta blob detector on the supplied screenshots and saves
 * a debug image that outlines every detected blob in green with a
 * yellow crosshair at the centre.
 */

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";
import { detectAllMagentaObjects, saveBitmapWithMagentaDetection } from "./magenta-object-detector";

const DEBUG_OUTPUT_DIR = "./test-image-debug";

// ── helpers ──────────────────────────────────────────────────────────────────

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function expandArgs(args: string[]): string[] {
  const expanded: string[] = [];

  for (const arg of args) {
    if (!arg.includes("*")) {
      expanded.push(arg);
      continue;
    }

    const normalized = arg.replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    const dir = slash >= 0 ? normalized.slice(0, slash) : ".";
    const filePattern = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const re = patternToRegex(filePattern);

    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      expanded.push(arg);
      continue;
    }

    const matches = fs
      .readdirSync(dir)
      .filter((e) => re.test(e) && /\.(png|jpg|jpeg)$/i.test(e))
      .map((e) => path.join(dir, e));

    expanded.push(...(matches.length > 0 ? matches : [arg]));
  }

  return expanded;
}

async function loadBitmap(filePath: string): Promise<RobotBitmap | null> {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return null;
  }

  return new Promise((resolve) => {
    const png = new PNG();
    fs.createReadStream(filePath)
      .pipe(png)
      .on("parsed", function (this: PNG) {
        const buf = Buffer.alloc(png.width * png.height * 4);
        for (let i = 0; i < png.data.length; i += 4) {
          buf[i] = png.data[i + 2]; // B
          buf[i + 1] = png.data[i + 1]; // G
          buf[i + 2] = png.data[i]; // R
          buf[i + 3] = 255;
        }
        resolve({ width: png.width, height: png.height, byteWidth: png.width * 4, bytesPerPixel: 4, image: buf });
      })
      .on("error", (e) => {
        console.error(`Load error: ${e}`);
        resolve(null);
      });
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function run(inputPaths: string[]): Promise<void> {
  if (inputPaths.length === 0) {
    console.warn("No images provided.");
    return;
  }

  for (const screenshotPath of inputPaths) {
    const name = path.basename(screenshotPath);
    const bitmap = await loadBitmap(screenshotPath);
    if (!bitmap) {
      console.error(`SKIP  ${name}  — could not load`);
      continue;
    }

    const blobs = detectAllMagentaObjects(bitmap, 80);

    if (blobs.length === 0) {
      console.warn(`NONE  ${name}  — no magenta blobs detected (minPixels=80)`);
    } else {
      console.log(`FOUND ${name}  — ${blobs.length} blob(s):`);
      for (let i = 0; i < blobs.length; i += 1) {
        const b = blobs[i];
        console.log(
          `  [${i + 1}] center=(${b.centerX},${b.centerY}) size=${b.width}x${b.height} pixels=${b.pixelCount} bounds=(${b.minX},${b.minY})-(${b.maxX},${b.maxY})`,
        );
      }
    }

    const debugPath = path.join(DEBUG_OUTPUT_DIR, name.replace(/\.(png|jpg|jpeg)$/i, "-magenta-debug.png"));
    saveBitmapWithMagentaDetection(bitmap, blobs, debugPath);
    console.log(`  debug: ${debugPath}`);
  }
}

const args = process.argv.slice(2);
const paths = expandArgs(args.length > 0 ? args : ["test-images/object-magenta/*.png"]);
run(paths);
