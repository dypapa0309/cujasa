import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  extractPolibotTextFromBuffer,
  inferPolibotFileType,
  normalizePolibotKnowledgeSource
} from '../services/polibotKnowledgeService.js';

const sourceDir = process.argv[2] || '/Users/sangbinsmacbook/Downloads/polibot_doc';
const outputFile = new URL('../data/polibotSeedKnowledge.json', import.meta.url);
const supported = new Set(['pdf', 'pptx', 'csv', 'txt', 'image']);

async function main() {
  const names = await readdir(sourceDir);
  const items = [];
  for (const name of names) {
    if (name.startsWith('.') || name === '__MACOSX') continue;
    const filePath = path.join(sourceDir, name);
    const fileType = inferPolibotFileType(name);
    if (!supported.has(fileType)) continue;
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
  }
  const sorted = items.sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(a.fileName).localeCompare(String(b.fileName), 'ko'));
  await writeFile(outputFile, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${sorted.length} POLIBOT knowledge items to ${outputFile.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
