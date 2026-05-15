const fs = require("fs");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "..");
const debugDir = path.resolve(workspaceRoot, "test-image-debug");

if (!debugDir.startsWith(workspaceRoot + path.sep)) {
  throw new Error(`Refusing to clean path outside workspace: ${debugDir}`);
}

fs.rmSync(debugDir, { recursive: true, force: true });
fs.mkdirSync(debugDir, { recursive: true });
console.log(`Cleaned ${path.relative(workspaceRoot, debugDir)}`);
