import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { transact } from './store';

export class HttpError extends Error {
  constructor(message:string,public status=400){super(message);}
}
function equal(a:string,b:string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
}
export function isLocalAccess(request:Request) {
  if(process.env.VERCEL||process.env.LOCAL_DEMO_ACCESS!=='true')return false;
  try{
    const loopback=(hostname:string)=>['127.0.0.1','localhost','[::1]'].includes(hostname);
    const url=new URL(request.url);
    const host=new URL(`http://${request.headers.get('host')||url.host}`).hostname;
    const forwarded=request.headers.get('x-forwarded-host');
    return loopback(url.hostname)&&loopback(host)&&(!forwarded||forwarded.split(',').every(value=>loopback(new URL(`http://${value.trim()}`).hostname)));
  }catch{return false;}
}
function signingSecret() {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length<32) throw new HttpError('Set a strong AUTH_SECRET before enabling hosted access.',503);
  return process.env.AUTH_SECRET + ':' + (process.env.ADMIN_PASSWORD || '');
}
export function signSession(now=Date.now()) {
  const body=Buffer.from(JSON.stringify({owner:'James',expires:now+8*60*60*1000})).toString('base64url');
  return body+'.'+createHmac('sha256',signingSecret()).update(body).digest('base64url');
}
export function validSession(token:string,now=Date.now()) {
  try {
    const [body,signature,...rest]=token.split('.');
    if(rest.length || !body || !signature) return false;
    if(!equal(signature,createHmac('sha256',signingSecret()).update(body).digest('base64url')))return false;
    const parsed=JSON.parse(Buffer.from(body,'base64url').toString());
    return parsed.owner==='James' && typeof parsed.expires==='number' && parsed.expires>now && parsed.expires<=now+8*60*60*1000;
  } catch{return false;}
}
export function requireOwner(request:Request) {
  if(isLocalAccess(request)) return;
  const cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('newsroom_session='))?.slice(17);
  if(!cookie || !validSession(cookie))throw new HttpError('Sign in to James’s newsroom.',401);
}
export function requireSameOrigin(request:Request) {
  const origin=request.headers.get('origin');
  // Next's internal URL can use localhost while the browser correctly addresses 127.0.0.1.
  // The HTTP Host is the actual requested authority; a cross-site browser cannot override it.
  const url=new URL(request.url);
  const host=request.headers.get('host')||url.host;
  const protocol=process.env.VERCEL?'https:':url.protocol;
  if(!origin || origin!==`${protocol}//${host}`)throw new HttpError('This action must come from the newsroom website.',403);
}
export async function authenticate(request:Request,password:string) {
  if(!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length<16)throw new HttpError('Set ADMIN_PASSWORD with at least 16 characters.',503);
  const address=(request.headers.get('x-forwarded-for')||'local').split(',')[0].trim();
  const key=createHmac('sha256',signingSecret()).update(address).digest('hex').slice(0,24);
  const now=Date.now();
  const allowed=await transact(data=>{
    for(const [id,attempt] of Object.entries(data.loginAttempts))if(attempt.until<=now)delete data.loginAttempts[id];
    const attempt=data.loginAttempts[key]??{count:0,until:now+15*60*1000};
    if(attempt.count>=5)return false;
    attempt.count++;data.loginAttempts[key]=attempt;return true;
  });
  if(!allowed)throw new HttpError('Too many sign-in attempts. Try again in 15 minutes.',429);
  if(!equal(password,process.env.ADMIN_PASSWORD))throw new HttpError('Incorrect password.',401);
  await transact(data=>{delete data.loginAttempts[key];});
  return signSession();
}
export function requireCron(request:Request) {
  const secret=process.env.CRON_SECRET;
  if(!secret || secret.length<32 || !equal(request.headers.get('authorization')||'',`Bearer ${secret}`))throw new HttpError('Unauthorized scheduler.',401);
}
export function errorResponse(error:unknown) {
  if(error instanceof HttpError)return Response.json({error:error.message},{status:error.status});
  if(error instanceof Error && ['ZodError','SyntaxError','WebhookVerificationError'].includes(error.name))return Response.json({error:'Invalid request or webhook signature.'},{status:400});
  if(error instanceof Error && error.name==='AdapterConfigurationError')return Response.json({error:error.message},{status:503});
  // Provider failures can contain response content; keep credentials/source material out of public errors.
  return Response.json({error:'The operation could not complete. Check the service configuration and try again.'},{status:500});
}
