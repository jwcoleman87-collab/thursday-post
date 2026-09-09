import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import { createState } from './engine';
import type { NewsroomState, SourceItem } from './domain';
import { getSourceRegistry, type RegisteredSource } from './ingestion';

export interface StoreData {
  version: 1;
  revision: number;
  state: NewsroomState;
  sources: RegisteredSource[];
  inbox: SourceItem[];
  monitoring: boolean;
  sourceCursor: number;
  lease?: { id: string; expiresAt: string; mode: 'demo'|'live' };
  loginAttempts: Record<string, { count: number; until: number }>;
}
export function initialStore(): StoreData {
  return {version:1,revision:0,state:createState(),sources:getSourceRegistry(),inbox:[],monitoring:process.env.MONITORING_ENABLED==='true',sourceCursor:0,loginAttempts:{}};
}
let local: DatabaseSync | undefined;
let remote: ReturnType<typeof postgres> | undefined;
let initialized: Promise<void> | undefined;
function sqlite() {
  if (process.env.VERCEL) throw new Error('DATABASE_URL is required on Vercel. No ephemeral storage fallback is allowed.');
  if (!local) {
    const filename = resolve(/* turbopackIgnore: true */ process.env.NEWSROOM_DB_FILE || 'data/newsroom.sqlite');
    mkdirSync(dirname(filename), {recursive:true});
    local = new DatabaseSync(filename);
    local.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS newsroom (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)');
    local.prepare('INSERT OR IGNORE INTO newsroom(id,payload) VALUES (1,?)').run(JSON.stringify(initialStore()));
  }
  return local;
}
async function pg() {
  remote ??= postgres(process.env.DATABASE_URL!, {max:3,idle_timeout:20,connect_timeout:10});
  initialized ??= (async()=>{
    await remote!`CREATE TABLE IF NOT EXISTS newsroom (id integer PRIMARY KEY CHECK(id=1), payload jsonb NOT NULL)`;
    await remote!`INSERT INTO newsroom(id,payload) VALUES(1,${remote!.json(initialStore() as never)}) ON CONFLICT(id) DO NOTHING`;
  })().catch(error=>{initialized=undefined;throw error;});
  await initialized;
  return remote;
}
function decode(value: unknown): StoreData {
  const result = (typeof value === 'string' ? JSON.parse(value) : value) as StoreData;
  if (result.version!==1 || result.state?.schemaVersion!==1 || !Array.isArray(result.state.stories)) throw new Error('Unsupported or damaged newsroom database. Restore a backup before proceeding.');
  return result;
}
/** Mutators are synchronous: never hold a database lock across a network request. */
export async function transact<T>(fn:(data:StoreData)=>T):Promise<T> {
  if (process.env.DATABASE_URL) {
    const sql=await pg();
    return await sql.begin(async transaction=>{
      const [row]=await transaction`SELECT payload FROM newsroom WHERE id=1 FOR UPDATE`;
      const data=decode(row.payload);
      const result=fn(data);
      data.revision++;
      await transaction`UPDATE newsroom SET payload=${transaction.json(data as never)} WHERE id=1`;
      return result;
    }) as T;
  }
  const db=sqlite();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row=db.prepare('SELECT payload FROM newsroom WHERE id=1').get() as {payload:string};
    const data=decode(row.payload);
    const result=fn(data);
    data.revision++;
    db.prepare('UPDATE newsroom SET payload=? WHERE id=1').run(JSON.stringify(data));
    db.exec('COMMIT');
    return result;
  } catch(error) {db.exec('ROLLBACK');throw error;}
}
export async function readStore():Promise<StoreData> {
  if (process.env.DATABASE_URL) {
    const sql=await pg();
    const [row]=await sql`SELECT payload FROM newsroom WHERE id=1`;
    return decode(row.payload);
  }
  const row=sqlite().prepare('SELECT payload FROM newsroom WHERE id=1').get() as {payload:string};
  return decode(row.payload);
}

export async function closeStore() {
  local?.close();local=undefined;
  if(remote)await remote.end({timeout:3});
  remote=undefined;initialized=undefined;
}
