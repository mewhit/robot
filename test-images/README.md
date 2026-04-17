# Coordinate Detector Test Suite

This directory contains test screenshots for validating the coordinate detector.

## How to Use

1. **Add test screenshots** to this directory (PNG format)
   - Name them descriptively, e.g., `tile-3639-9500.png`, `tile-3551-3507.png`

2. **Run the detector test** against one or more screenshots:

```bash
# Test a single screenshot
npx ts-node src/main/automateBots/test-detector.ts test-images/tile-3639-9500.png

# Test all PNG files in the directory
npx ts-node src/main/automateBots/test-detector.ts test-images/*.png
```

3. **Review results**:
   - Console output shows detected coordinates
   - Debug PNG with red box is saved to `./ocr-debug/` directory

## Expected Test Cases

From your screenshots:

- ✓ Tile 3639, 9500, 0 (fullscreen)
- ✓ Tile 3551, 3507, 0 (standard view)

## Output Files

The test creates debug images in `./ocr-debug/`:

- `{name}-detected.png` - Screenshot with red box around detected overlay
- Contains coordinates printed to console

## Adding New Tests

1. Take a screenshot in RuneLite
2. Save as PNG to `test-images/`
3. Run test script
4. Verify detection works and coordinates are correct

---

The detector should successfully find the "Tile X, Y, Z" overlay in the top-left corner of any RuneLite screenshot.
