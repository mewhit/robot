import { Monitor } from "node-screenshots";
import * as robotModule from "robotjs";

export type ScreenCaptureBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenBitmap = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
  colorAt: (x: number, y: number) => string;
};

const robot = ((robotModule as unknown as { default?: typeof robotModule }).default ??
  robotModule) as typeof robotModule;

function normalizeCaptureBounds(bounds: ScreenCaptureBounds): ScreenCaptureBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function buildColorAt(image: Buffer, byteWidth: number, bytesPerPixel: number, width: number, height: number) {
  return (x: number, y: number): string => {
    const localX = Math.max(0, Math.min(width - 1, Math.floor(x)));
    const localY = Math.max(0, Math.min(height - 1, Math.floor(y)));
    const offset = localY * byteWidth + localX * bytesPerPixel;
    const b = image[offset];
    const g = image[offset + 1];
    const r = image[offset + 2];
    return `${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  };
}

function bitmapFromRgbaRaw(rawImage: Buffer | Uint8Array, width: number, height: number): ScreenBitmap {
  const expectedMinBytes = width * height * 4;
  if (rawImage.length < expectedMinBytes) {
    throw new Error("node-screenshots raw image returned an unexpected buffer size.");
  }

  const converted = Buffer.alloc(expectedMinBytes);
  for (let i = 0; i < width * height; i += 1) {
    const sourceOffset = i * 4;
    const targetOffset = i * 4;
    const r = rawImage[sourceOffset];
    const g = rawImage[sourceOffset + 1];
    const b = rawImage[sourceOffset + 2];
    const a = rawImage[sourceOffset + 3];

    // Keep downstream compatibility with RobotJS-style BGR byte order.
    converted[targetOffset] = b;
    converted[targetOffset + 1] = g;
    converted[targetOffset + 2] = r;
    converted[targetOffset + 3] = a;
  }

  const byteWidth = width * 4;
  const bytesPerPixel = 4;

  return {
    width,
    height,
    byteWidth,
    bytesPerPixel,
    image: converted,
    colorAt: buildColorAt(converted, byteWidth, bytesPerPixel, width, height),
  };
}

function captureWithNodeScreenshots(bounds: ScreenCaptureBounds): ScreenBitmap {
  const probeX = bounds.x + Math.max(0, Math.floor(bounds.width / 2));
  const probeY = bounds.y + Math.max(0, Math.floor(bounds.height / 2));
  const monitor = Monitor.fromPoint(probeX, probeY) ?? Monitor.fromPoint(bounds.x, bounds.y);

  if (!monitor) {
    throw new Error("node-screenshots could not resolve monitor for capture bounds.");
  }

  const monitorX = monitor.x();
  const monitorY = monitor.y();
  const monitorWidth = Math.max(1, monitor.width());
  const monitorHeight = Math.max(1, monitor.height());
  const cropX = bounds.x - monitorX;
  const cropY = bounds.y - monitorY;
  const clampedX = Math.max(0, Math.min(monitorWidth - 1, cropX));
  const clampedY = Math.max(0, Math.min(monitorHeight - 1, cropY));
  const clampedWidth = Math.max(1, Math.min(bounds.width, monitorWidth - clampedX));
  const clampedHeight = Math.max(1, Math.min(bounds.height, monitorHeight - clampedY));

  const monitorImage = monitor.captureImageSync();
  const croppedImage = monitorImage.cropSync(clampedX, clampedY, clampedWidth, clampedHeight);
  const rawImage = croppedImage.toRawSync(true);

  return bitmapFromRgbaRaw(rawImage, clampedWidth, clampedHeight);
}

function captureWithRobotJs(bounds: ScreenCaptureBounds): ScreenBitmap {
  return robot.screen.capture(bounds.x, bounds.y, bounds.width, bounds.height) as unknown as ScreenBitmap;
}

export function captureScreenBitmap(bounds: ScreenCaptureBounds): ScreenBitmap {
  const normalizedBounds = normalizeCaptureBounds(bounds);

  if (process.platform !== "win32") {
    return captureWithRobotJs(normalizedBounds);
  }

  try {
    return captureWithNodeScreenshots(normalizedBounds);
  } catch {
    return captureWithRobotJs(normalizedBounds);
  }
}

export function captureScreenRect(x: number, y: number, width: number, height: number): ScreenBitmap {
  return captureScreenBitmap({ x, y, width, height });
}
