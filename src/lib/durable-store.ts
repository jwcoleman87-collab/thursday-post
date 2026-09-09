import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';

let local: DatabaseSync | undefined;
let remote: ReturnType<typeof postgres> | undefined;
let initialized: Promise<void> | undefined;
function keyCheck(key:string){if(!/^[a-z][a-z0-9._-]{0,99}$/.test(key))throw new Error('Invalid document namespace.');}
function sqlite(){
  if(process.env.VERCEL)throw new Error('DATABASE_URL is required on Vercel.');
  if(!local){
    const filename=resolve(/* turbopackIgnore: true */ process.env.NEWSROOM_DOCUMENT_DB_FILE||process.env.NEWSROOM_DB_FILE||'data/newsroom.sqlite');
    mkdirSync(dirname(filename),{recursive:true});
    local=new DatabaseSync(filename);
    local.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS newsroom_documents (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)');
  }
  return local;
}
async function pg(){
  remote??=postgres(process.env.DATABASE_URL!,{max:3,idle_timeout:20,connect_timeout:10});
  initialized??=(async()=>{await remote!`CREATE TABLE IF NOT EXISTS newsroom_documents (id text PRIMARY KEY, payload jsonb NOT NULL, revision integer NOT NULL DEFAULT 0)`;})().catch(error=>{initialized=undefined;throw error;});
  await initialized;return remote;
}
function decode<T>(value:unknown):T{return(typeof value==='string'?JSON.parse(value):value)as T;}
function syncResult<R>(result:R):R{if(result&&typeof(result as {then?:unknown}).then==='function')throw new Error('Document mutations must be synchronous; perform external calls outside the transaction.');return result;}
/** Each named document is isolated and locked transactionally. No external calls inside mutate. */
export async function updateDocument<T,R>(key:string,initial:()=>T,mutate:(data:T)=>R):Promise<R>{
  keyCheck(key);
  if(process.env.DATABASE_URL){
    const sql=await pg();
    return await sql.begin(async tx=>{
      await tx`INSERT INTO newsroom_documents(id,payload) VALUES(${key},${tx.json(initial() as never)}) ON CONFLICT(id) DO NOTHING`;
      const[row]=await tx`SELECT payload FROM newsroom_documents WHERE id=${key} FOR UPDATE`;
      const data=decode<T>(row.payload);const result=syncResult(mutate(data));
      await tx`UPDATE newsroom_documents SET payload=${tx.json(data as never)},revision=revision+1 WHERE id=${key}`;
      return result;
    }) as R;
  }
  const db=sqlite();db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('INSERT OR IGNORE INTO newsroom_documents(id,payload) VALUES(?,?)').run(key,JSON.stringify(initial()));
    const row=db.prepare('SELECT payload FROM newsroom_documents WHERE id=?').get(key)as{payload:string};
    const data=decode<T>(row.payload);const result=syncResult(mutate(data));
    db.prepare('UPDATE newsroom_documents SET payload=?,revision=revision+1 WHERE id=?').run(JSON.stringify(data),key);
    db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export async function readDocument<T>(key:string,initial:()=>T):Promise<T>{
  keyCheck(key);
  if(process.env.DATABASE_URL){const sql=await pg();const[row]=await sql`SELECT payload FROM newsroom_documents WHERE id=${key}`;return row?decode<T>(row.payload):initial();}
  const row=sqlite().prepare('SELECT payload FROM newsroom_documents WHERE id=?').get(key)as{payload:string}|undefined;
  return row?decode<T>(row.payload):initial();
}
export async function exportDocuments():Promise<Array<{id:string;payload:unknown;revision:number}>>{
  if(process.env.DATABASE_URL){const sql=await pg();return await sql`SELECT id,payload,revision FROM newsroom_documents ORDER BY id` as unknown as Array<{id:string;payload:unknown;revision:number}>;}
  return(sqlite().prepare('SELECT id,payload,revision FROM newsroom_documents ORDER BY id').all()as Array<{id:string;payload:string;revision:number}>).map(row=>({...row,payload:JSON.parse(row.payload)}));
}
export async function closeDocuments(){local?.close();local=undefined;if(remote)await remote.end({timeout:3});remote=undefined;initialized=undefined;}
