import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const project=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(project.projectName!=='the-racing-desk'||project.orgId!=='team_dCW82GqfRmq0Pl71eMgYL59J')throw new Error('Unapproved destination.');
const local=parseEnv(readFileSync('.env.local','utf8'));
if(!local.MEMBER_SESSION_SECRET||local.MEMBER_SESSION_SECRET.length<32)throw new Error('Generate the local member secret first.');
const auth=JSON.parse(readFileSync('.vercel/cli/auth.json','utf8'));
const entries=[
  {key:'MEMBER_SESSION_SECRET',value:local.MEMBER_SESSION_SECRET,type:'sensitive',target:['production','preview']},
  {key:'NEWSROOM_PUBLIC_URL',value:'https://the-racing-desk.vercel.app',type:'plain',target:['production','preview']},
];
const response=await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(project.projectId)}/env?teamId=${encodeURIComponent(project.orgId)}&upsert=true`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:JSON.stringify(entries),signal:AbortSignal.timeout(30000),redirect:'error'});
const result=await response.json();
if(!response.ok||result.failed?.length)throw new Error(`Member configuration failed with HTTP ${response.status}; private response omitted.`);
console.log('Member secret and canonical website URL saved to the approved Vercel project. No payment or mail credentials were changed.');
