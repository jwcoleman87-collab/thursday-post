import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
if (!existsSync('.env.local')) {
  const template = readFileSync('.env.example', 'utf8');
  const output = template.replace('AUTH_SECRET=', `AUTH_SECRET=${randomBytes(32).toString('base64url')}`)
    .replace('ADMIN_PASSWORD=', `ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}`)
    .replace('MEMBER_SESSION_SECRET=', `MEMBER_SESSION_SECRET=${randomBytes(32).toString('base64url')}`)
    .replace('CRON_SECRET=', `CRON_SECRET=${randomBytes(32).toString('base64url')}`);
  writeFileSync('.env.local', output, { mode: 0o600, flag: 'wx' });
  console.log('Created .env.local with unique secrets. Values are not logged.');
} else console.log('Existing .env.local preserved.');
mkdirSync('data', { recursive: true });
console.log('Local setup ready. npm run build, then npm start.');
