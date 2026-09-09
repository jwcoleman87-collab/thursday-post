import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createBackup } from '../src/lib/backup.ts';
import { closeStore } from '../src/lib/store.ts';
import { closeDocuments } from '../src/lib/durable-store.ts';

try {
  const { values } = parseArgs({ options: { output: { type: 'string' } }, allowPositionals: false });
  if (!values.output) throw new Error('Specify --output with a new private backup filename.');
  if (!process.env.DATABASE_URL && !existsSync(resolve(process.env.NEWSROOM_DB_FILE || 'data/newsroom.sqlite'))) throw new Error('The configured source SQLite database does not exist. No empty backup was created.');
  const backup = await createBackup();
  const filename = resolve(values.output);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(backup), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(`Private backup saved. Store revision ${backup.payload.store.revision}; ${backup.payload.documents.length} named document(s); SHA-256 integrity recorded.`);
} catch (error) {
  console.error(error?.name === 'HttpError' ? error.message : 'Backup could not be saved. Check the explicit source configuration and choose a new writable output file. Existing files are never overwritten.');
  process.exitCode = 1;
} finally { await closeDocuments(); await closeStore(); }
