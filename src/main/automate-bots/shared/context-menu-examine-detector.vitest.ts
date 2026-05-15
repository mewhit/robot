import fs from "fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { ScreenBitmap } from "../../windowsScreenCapture";
import {
  detectContextMenuTextBands,
  findContextMenuLabelMatch,
  formatContextMenuWordMatch,
} from "./context-menu-examine-detector";

function loadScreenBitmap(filePath: string): Promise<ScreenBitmap> {
  return new Promise((resolve, reject) => {
    const png = new PNG();
    fs.createReadStream(filePath)
      .pipe(png)
      .on("parsed", function (this: PNG) {
        const image = Buffer.alloc(png.width * png.height * 4);
        for (let index = 0; index < png.data.length; index += 4) {
          image[index] = png.data[index + 2];
          image[index + 1] = png.data[index + 1];
          image[index + 2] = png.data[index];
          image[index + 3] = png.data[index + 3];
        }

        resolve({
          width: png.width,
          height: png.height,
          byteWidth: png.width * 4,
          bytesPerPixel: 4,
          image,
          colorAt: () => "",
        });
      })
      .on("error", reject);
  });
}

describe("context menu label detector", () => {
  it("selects the Trade row above Talk-to for a shop keeper menu", async () => {
    const bitmap = await loadScreenBitmap("test-images/context-menu/shop-keeper-trade-talk-to.png");
    const menuBox = { x: 16, y: 18, width: 190, height: 124 };
    const textBands = detectContextMenuTextBands(bitmap, { x: 110, y: 70 }, { menuBox, rowHeightPx: 19 });
    const result = findContextMenuLabelMatch(bitmap, textBands, menuBox, "Trade");

    expect(result.match, result.matches.map(formatContextMenuWordMatch).join("|")).not.toBeNull();
    expect(result.match?.label).toBe("Trade");
    expect(result.match?.band.centerY).toBeLessThan(70);
    expect(result.match?.wordBox.width).toBeLessThan(56);
  });

  it("does not infer Trade from a Walk here menu", async () => {
    const bitmap = await loadScreenBitmap("test-images/context-menu/walk-here-no-trade.png");
    const menuBox = { x: 21, y: 15, width: 135, height: 69 };
    const textBands = detectContextMenuTextBands(bitmap, { x: 85, y: 42 }, { menuBox, rowHeightPx: 19 });
    const result = findContextMenuLabelMatch(bitmap, textBands, menuBox, "Trade");

    expect(result.match, result.matches.map(formatContextMenuWordMatch).join("|")).toBeNull();
  });
});
