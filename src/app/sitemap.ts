import type {MetadataRoute} from 'next';
export default function sitemap():MetadataRoute.Sitemap{const origin=process.env.NEWSROOM_PUBLIC_URL||'https://the-racing-desk.vercel.app';return ['','/news','/editions','/subscribe','/about','/post-box','/corrections','/contact','/terms','/privacy'].map(path=>({url:origin+path}));}
