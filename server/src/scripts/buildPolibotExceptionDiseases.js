import AdmZip from 'adm-zip';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  extractPolibotTextFromBuffer,
  inferPolibotFileType
} from '../services/polibotKnowledgeService.js';
import {
  extractPolibotExceptionDiseases,
  normalizePolibotExceptionDiseaseSource,
  summarizePolibotExceptionDiseases
} from '../services/polibotExceptionDiseaseService.js';

const defaultZipPaths = [
  '/Users/sangbinsmacbook/Downloads/polibot_doc2/손보_간편보험 예외질환 리스트.zip',
  '/Users/sangbinsmacbook/Downloads/polibot_doc2/생보_간편보험 예외질환 리스트.Zip'
];

const outputFile = new URL('../data/polibotExceptionDiseases.json', import.meta.url);
const supported = new Set(['pdf', 'xlsx', 'xls', 'csv', 'txt']);

function parseArgs(argv = []) {
  const args = {
    zipPaths: [],
    outputFile
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--output') args.outputFile = new URL(path.resolve(argv[++index]), 'file:');
    else args.zipPaths.push(current);
  }
  if (args.zipPaths.length === 0) args.zipPaths = defaultZipPaths;
  return args;
}

function zipEntries(zipPath = '') {
  const zip = new AdmZip(zipPath);
  return zip.getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      zipPath,
      sourceZip: path.basename(zipPath),
      entryName: entry.entryName.normalize('NFC'),
      buffer: entry.getData(),
      size: entry.header.size
    }))
    .filter((entry) => supported.has(inferPolibotFileType(entry.entryName)));
}

async function sourceFromEntry(entry = {}) {
  const fileType = inferPolibotFileType(entry.entryName);
  let text = '';
  try {
    text = await extractPolibotTextFromBuffer(entry.buffer, entry.entryName);
  } catch (error) {
    console.warn(`[POLIBOT exceptions] ${entry.entryName} parse failed: ${error.message}`);
  }
  const source = normalizePolibotExceptionDiseaseSource({
    fileName: entry.entryName,
    sourceZip: entry.sourceZip,
    text,
    size: entry.size || entry.buffer.length,
    fileType
  });
  return {
    source,
    text,
    diseases: extractPolibotExceptionDiseases({ source, text })
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const entries = args.zipPaths.flatMap(zipEntries);
  const sourceResults = [];
  for (const entry of entries) {
    sourceResults.push(await sourceFromEntry(entry));
    if (typeof global.gc === 'function') global.gc();
  }
  const sources = sourceResults.map((result) => ({
    ...result.source,
    extractedDiseaseCount: result.diseases.length
  }));
  const diseases = sourceResults
    .flatMap((result) => result.diseases)
    .sort((a, b) => (
      String(a.company).localeCompare(String(b.company), 'ko')
      || String(a.kcdCode || '').localeCompare(String(b.kcdCode || ''), 'ko')
      || String(a.diseaseName).localeCompare(String(b.diseaseName), 'ko')
    ))
    .map((item, index) => ({ ...item, id: `polibot-exception-disease-${index + 1}` }));
  const payload = {
    version: 1,
    generatedFrom: args.zipPaths.map((zipPath) => path.basename(zipPath)),
    summary: summarizePolibotExceptionDiseases(sources, diseases),
    sources,
    diseases
  };
  await writeFile(args.outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(payload.summary, null, 2));
  console.log(`Wrote ${diseases.length} exception disease rows to ${args.outputFile.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
