#!/usr/bin/env node
/**
 * @file Guard fig-editor against recreating a document model beside Kiwi.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import console from "node:console";
import process from "node:process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function token(...parts) {
  return parts.join("");
}

function rel(path) {
  return relative(packageRoot, path);
}

function entries(dir) {
  if (!existsSync(dir)) {
    errors.push(`Required directory is missing: ${rel(dir)}`);
    return [];
  }
  return readdirSync(dir).map((name) => ({
    name,
    path: join(dir, name),
    stat: statSync(join(dir, name)),
  }));
}

function requireFiles(paths) {
  for (const path of paths) {
    if (!existsSync(path) || !statSync(path).isFile()) {
      errors.push(`Required file is missing: ${rel(path)}`);
    }
  }
}

function walk(dir) {
  for (const entry of entries(dir)) {
    if (entry.stat.isDirectory()) {
      walk(entry.path);
      continue;
    }
    if (entry.stat.isFile()) {
      yieldFile(entry.path);
    }
  }
}

const forbidden = [
  token("Fig", "Design", "Document"),
  token("Fig", "Design", "Node"),
  token("Fig", "Node", "Id"),
  token("Fig", "Page", "Id"),
  token("create", "Fig", "Design", "Document"),
  token("create", "Empty", "Fig", "Design", "Document"),
  token("document", "To", "Tree"),
  token("tree", "To", "Document"),
  token("design", "Document", "To", "Kiwi", "Document"),
  token("kiwi", "Document", "To", "Design", "Document"),
  token("comp", "at"),
  token("adapt", "er"),
  token("symbol", "Map"),
];

function yieldFile(path) {
  if (!/\.(ts|tsx)$/.test(path)) {
    return;
  }
  const source = readFileSync(path, "utf8");
  for (const token of forbidden) {
    if (source.includes(token)) {
      errors.push(`${rel(path)} contains forbidden token: ${token}`);
    }
  }
}

const src = join(packageRoot, "src");
requireFiles([
  join(src, "index.ts"),
  join(src, "context", "FigEditorContext.tsx"),
  join(src, "canvas", "FigEditorCanvas.tsx"),
]);
walk(src);

if (errors.length > 0) {
  console.error("fig-editor architecture guard failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}
