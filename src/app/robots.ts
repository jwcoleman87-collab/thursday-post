import type {MetadataRoute} from 'next';
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:'/',disallow:['/api/','/newsroom','/operations','/editorial/','/member','/login']},sitemap:`${process.env.NEWSROOM_PUBLIC_URL||'https://the-racing-desk.vercel.app'}/sitemap.xml`};}
