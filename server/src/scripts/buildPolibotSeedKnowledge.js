import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  extractPolibotTextFromBuffer,
  inferPolibotFileType,
  normalizePolibotKnowledgeSource
} from '../services/polibotKnowledgeService.js';

const sourceDir = process.argv[2] || '/Users/sangbinsmacbook/Downloads/polibot_doc';
const outputFile = new URL('../data/polibotSeedKnowledge.json', import.meta.url);
const supported = new Set(['pdf', 'pptx', 'docx', 'xlsx', 'csv', 'txt', 'image']);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
      continue;
    }
    const fileType = inferPolibotFileType(entry.name);
    if (supported.has(fileType)) files.push(fullPath);
  }
  return files;
}

async function main() {
  const filePaths = await listFiles(sourceDir);
  const items = [];
  for (const filePath of filePaths) {
    const name = path.relative(sourceDir, filePath);
    const fileType = inferPolibotFileType(name);
    const buffer = await readFile(filePath);
    let text = '';
    if (fileType !== 'image') {
      try {
        text = await extractPolibotTextFromBuffer(buffer, name);
      } catch (error) {
        text = '';
        console.warn(`[POLIBOT seed] ${name} parse failed: ${error.message}`);
      }
    }
    items.push(normalizePolibotKnowledgeSource({
      fileName: name,
      text,
      size: buffer.length,
      type: fileType
    }));
    text = '';
    if (typeof global.gc === 'function') global.gc();
  }
  const sorted = items.sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(a.fileName).localeCompare(String(b.fileName), 'ko'));
  await writeFile(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${sorted.length} POLIBOT knowledge items to ${outputFile.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
