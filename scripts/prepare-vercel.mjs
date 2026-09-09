import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
process.loadEnvFile('.env.local');
const project=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(project.projectName!=='the-racing-desk'||project.orgId!=='team_dCW82GqfRmq0Pl71eMgYL59J')throw new Error('Deployment destination does not match the approved project.');
const defaults={
  NEWSROOM_CONTACT_EMAIL:process.env.NEWSROOM_CONTACT_EMAIL||'workbenchadmin@gmail.com',
  NEWSROOM_MODE:'live',NEWSROOM_MODEL:process.env.NEWSROOM_MODEL||'openai/gpt-4.1-mini',
  LOCAL_DEMO_ACCESS:'false',MONITORING_ENABLED:'false',NEWSROOM_AI_PAUSED:process.env.NEWSROOM_AI_PAUSED||'true',
  NEWSROOM_ENABLED_SOURCES:'racing-queensland',
  NEWSROOM_SOURCE_REVIEWED_AT:new Date().toISOString()
};
const entries=Object.entries(defaults).map(([key,value])=>({key,value,type:'plain',target:['production','preview']}));
for(const key of ['AUTH_SECRET','ADMIN_PASSWORD','CRON_SECRET']){
  const value=process.env[key]||randomBytes(32).toString('base64url');
  entries.push({key,value,type:'sensitive',target:['production','preview']});
}
writeFileSync('.vercel/deployment-env.json',JSON.stringify(entries),{mode:0o600});
mkdirSync('data',{recursive:true});
writeFileSync('data/OWNER-ACCESS.txt',`The Racing Desk — private owner access\n\nOwner: James\nLogin password: ${entries.find(entry=>entry.key==='ADMIN_PASSWORD').value}\n\nSign in: https://the-racing-desk.vercel.app/login\nKeep this file private.\n`,{mode:0o600});
console.log(`Prepared ${entries.length} deployment settings for ${project.projectName}; secret values were not printed.`);
