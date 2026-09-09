import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { MAX_BACKUP_BYTES, parseBackup, restoreBackupToNewPostgres, restoreBackupToNewSqlite } from '../src/lib/backup.ts';

try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, sqlite: { type: 'string' }, 'postgres-env': { type: 'string' } }, allowPositionals: false });
  if (!values.input || Boolean(values.sqlite) === Boolean(values['postgres-env'])) throw new Error('Specify --input and exactly one of --sqlite or --postgres-env.');
  if ((await stat(values.input)).size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the supported size limit.');
  const backup = parseBackup(await readFile(values.input));
  let result;
  if (values.sqlite) result = restoreBackupToNewSqlite(backup, values.sqlite);
  else {
    const name = values['postgres-env'];
    if (!/^[A-Z_][A-Z0-9_]{2,100}$/.test(name) || name === 'DATABASE_URL' || !process.env[name]) throw new Error('Choose a separate environment variable containing the explicit new target database connection.');
    result = await restoreBackupToNewPostgres(backup, process.env[name]);
  }
  console.log(`Isolated restore verified. Store revision ${result.storeRevision}; ${result.documents} named document(s). Source data was not changed.`);
} catch (error) {
  console.error(error?.name === 'HttpError' ? error.message : 'Restore refused or failed. Use an intact backup and a new local file or an empty, explicitly different Postgres target. Connection strings are never printed.');
  process.exitCode = 1;
}
