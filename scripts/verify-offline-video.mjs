import { readFile } from 'node:fs/promises';
import { benchmarkOfflineExport } from '../src/offline-benchmark.js';
const path = process.argv[2];
if (!path) {
  console.error(
    '使い方: node scripts/verify-offline-video.mjs /private/path/shot-offline-xxx.json'
  );
  process.exitCode = 1;
} else
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    console.log(JSON.stringify(benchmarkOfflineExport(data), null, 2));
  } catch (error) {
    console.error(`検証できませんでした: ${error.message}`);
    process.exitCode = 1;
  }
