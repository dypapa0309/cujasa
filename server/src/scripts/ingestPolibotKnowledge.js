import 'dotenv/config';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  extractPolibotTextFromBuffer,
  inferPolibotFileType
} from '../services/polibotKnowledgeService.js';
import { ingestPolibotKnowledge } from '../services/polibotKnowledgeDbService.js';

const supported = new Set(['pdf', 'pptx', 'docx', 'xlsx', 'csv', 'txt', 'image', 'hwp']);

function parseArgs(argv = []) {
  const args = {
    sourceDir: '',
    scope: 'global',
    userId: '',
    dryRun: false,
    sourceChannel: 'local_ingest',
    month: '',
    note: ''
  };
  const rest = [...argv];
  args.sourceDir = rest.shift() || '';
  for (let index = 0; index < rest.length; index += 1) {
    const current = rest[index];
    if (current === '--scope') args.scope = rest[++index] || args.scope;
    else if (current === '--user-id') args.userId = rest[++index] || '';
    else if (current === '--dry-run') args.dryRun = true;
    else if (current === '--source-channel') args.sourceChannel = rest[++index] || args.sourceChannel;
    else if (current === '--month') args.month = rest[++index] || '';
    else if (current === '--note') args.note = rest[++index] || '';
  }
  return args;
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

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
    if (!supported.has(fileType)) continue;
    files.push(fullPath);
  }
  return files;
}

async function readKnowledgeFile(filePath) {
  const buffer = await readFile(filePath);
  const fileInfo = await stat(filePath);
  const fileName = path.basename(filePath);
  const fileType = inferPolibotFileType(fileName);
  let text = '';
  if (fileType !== 'image' && fileType !== 'hwp') {
    try {
      text = await extractPolibotTextFromBuffer(buffer, fileName);
    } catch (error) {
      console.warn(`[POLIBOT ingest] ${fileName} parse failed: ${error.message}`);
    }
  }
  return {
    name: fileName,
    fileName,
    text,
    size: fileInfo.size,
    type: fileType,
    storagePath: filePath,
    fileHash: sha256Buffer(buffer)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sourceDir) {
    console.error('Usage: node server/src/scripts/ingestPolibotKnowledge.js /path/to/folder --scope global [--dry-run]');
    process.exit(1);
  }
  if (args.scope === 'user' && !args.userId) {
    console.error('--scope user requires --user-id <uuid>');
    process.exit(1);
  }

  const filePaths = await listFiles(args.sourceDir);
  const result = {
    summary: {
      total: filePaths.length,
      insertedSources: 0,
      duplicateSources: 0,
      insertedChunks: 0,
      skippedChunks: 0,
      insertedCatalogItems: 0,
      insertedConversationInsights: 0,
      duplicateChunks: 0,
      failed: 0,
      dryRun: Boolean(args.dryRun)
    },
    errors: []
  };
  for (const filePath of filePaths) {
    try {
      const file = await readKnowledgeFile(filePath);
      const batch = await ingestPolibotKnowledge({
        userId: args.userId,
        scope: args.scope,
        sourceChannel: args.sourceChannel,
        sourceLabel: path.relative(args.sourceDir, filePath) || args.sourceDir,
        files: [file],
        month: args.month,
        note: args.note,
        dryRun: args.dryRun
      });
      Object.entries(batch.summary || {}).forEach(([key, value]) => {
        if (key === 'total' || key === 'dryRun') return;
        if (typeof value === 'number') result.summary[key] = (result.summary[key] || 0) + value;
      });
      result.errors.push(...(batch.errors || []));
    } catch (error) {
      result.summary.failed += 1;
      result.errors.push({ fileName: path.basename(filePath), error: error.message || String(error) });
    }
    if (typeof global.gc === 'function') global.gc();
  }

  console.log(JSON.stringify({
    sourceDir: args.sourceDir,
    scope: args.scope,
    dryRun: args.dryRun,
    ...result.summary,
    errors: result.errors
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
