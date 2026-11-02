import type { ReactNode } from 'react';
export function Link({href,children,...props}: {href:string;children?:ReactNode;className?:string;[key:string]:unknown}) {return <a {...props} href={href} onClick={e=>e.preventDefault()}>{children}</a>}
export const useLocation=():[string,()=>void]=>['/avatar-assets',()=>{}];
export function AuthControl(){return <span className="mono text-[11px] opacity-60">로그인</span>}
export const useGetHealth=(_options?:unknown)=>({isError:false,data:{status:'ok'}});
export const useHealthCheck=useGetHealth;
export const useGetReadiness=(_options?:unknown)=>({isError:false,data:{database:true,liveEnabled:true,message:''}});
export type ProvisioningProvider={id:string;name:string;imageCreation:boolean;customTraining:boolean;reusableId:boolean;realtimeRendering:boolean;emotionControl:string;adapterEnabled:boolean;configured:boolean;requirements:string[]};
export const getListProvisioningProvidersQueryKey=()=>['mockup'];
export const useListProvisioningProviders=(_options:unknown)=>({isLoading:false,isError:false,refetch:()=>{},data:[{id:'tavus',name:'Tavus',imageCreation:true,customTraining:true,reusableId:true,realtimeRendering:true,emotionControl:'provider',adapterEnabled:true,configured:true,requirements:['명시적 비용 확인']},{id:'anam',name:'Anam',imageCreation:false,customTraining:false,reusableId:true,realtimeRendering:true,emotionControl:'provider',adapterEnabled:true,configured:true,requirements:['기본 아바타 지원']}] satisfies ProvisioningProvider[]});
