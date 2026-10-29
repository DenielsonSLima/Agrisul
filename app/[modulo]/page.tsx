import { AppShell } from "@/shared/components/AppShell";
import { searchString } from "@/shared/navigation/searchString";
import {redirect} from 'next/navigation';
export default async function Page({params,searchParams}:{params:Promise<{modulo:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {modulo}=await params;
  if(modulo==='planejamento')redirect('/');
  if(modulo==='acompanhamento'||modulo==='resumo')redirect('/dashboard'+searchString(await searchParams));
  return <AppShell initialHref={"/"+modulo+searchString(await searchParams)}/>;
}
