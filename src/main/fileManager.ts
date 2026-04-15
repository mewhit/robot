import * as fs from "fs";
import * as path from "path";
import { AppState } from "./global-state";
import { ExplorerNode } from "./types";

export function ensureOutputFolder() {
  fs.mkdirSync(AppState.outputFolderPath, { recursive: true });
}

export function toCsvFileName(fileName: string): string {
  return /\.csv$/i.test(fileName) ? fileName : `${fileName}.csv`;
}

export function ensureCsvFileInitialized(filePath: string) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf8");
    return;
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    fs.writeFileSync(filePath, "", "utf8");
  }
}

export function normalizeRelativePath(relativePath: string): string {
  return path.normalize(relativePath).replace(/^([\\/])+/, "");
}

export function resolveInsideOutputFolder(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const resolved = path.resolve(AppState.outputFolderPath, normalized);
  const root = path.resolve(AppState.outputFolderPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path escapes output folder");
  }
  return resolved;
}

export function buildExplorerTree(rootDir: string, baseRelative = ""): ExplorerNode[] {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const nodes: ExplorerNode[] = [];

  for (const entry of entries) {
    const relativePath = baseRelative ? path.join(baseRelative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        relativePath,
        isDirectory: true,
        children: buildExplorerTree(path.join(rootDir, entry.name), relativePath),
      });
    } else {
      nodes.push({
        name: entry.name,
        relativePath,
        isDirectory: false,
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function listOutputFolderFiles(): string[] {
  const tree = buildExplorerTree(AppState.outputFolderPath);
  const fileNames: string[] = [];

  const walk = (nodes: ExplorerNode[]) => {
    for (const node of nodes) {
      if (node.isDirectory) {
        walk(node.children ?? []);
      } else {
        fileNames.push(node.relativePath);
      }
    }
  };

  walk(tree);
  return fileNames;
}
