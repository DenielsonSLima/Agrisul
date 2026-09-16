import { AppShell } from "@/shared/components/AppShell";
import { searchString } from "@/shared/navigation/searchString";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  return <AppShell initialHref={"/"+searchString(await searchParams)}/>;
}
