import {readFileSync,writeFileSync} from 'node:fs';
const updates={NEWSROOM_CONTACT_EMAIL:'workbenchadmin@gmail.com',NEWSROOM_AI_PAUSED:'true'};
const project=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(project.projectName!=='the-racing-desk'||project.orgId!=='team_dCW82GqfRmq0Pl71eMgYL59J')throw new Error('Unapproved destination.');
let local=readFileSync('.env.local','utf8');
for(const [key,value] of Object.entries(updates)){
  const pattern=new RegExp(`^${key}=.*$`,'m');
  local=pattern.test(local)?local.replace(pattern,`${key}=${value}`):`${local}\n${key}=${value}\n`;
}
writeFileSync('.env.local',local,{mode:0o600});
const auth=JSON.parse(readFileSync('.vercel/cli/auth.json','utf8'));
const response=await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(project.projectId)}/env?teamId=${encodeURIComponent(project.orgId)}&upsert=true`,{
  method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},
  body:JSON.stringify(Object.entries(updates).map(([key,value])=>({key,value,type:'plain',target:['production','preview']}))),signal:AbortSignal.timeout(30000),redirect:'error'
});
const result=await response.json();
if(!response.ok||result.failed?.length)throw new Error(`Configuration update failed with HTTP ${response.status}; private response omitted.`);
console.log('Confirmed reader address and paused live AI in local and approved Vercel project settings. No secret values printed.');
