import EditorialDesk from '@/components/editorial-desk';
export default async function Page({params}:{params:Promise<{id:string}>}){return <EditorialDesk storyId={(await params).id}/>;}
