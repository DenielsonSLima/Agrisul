import {useModuleNavigation} from "@/shared/navigation/ModuleNavigation";
import {cadastroSections} from "../sections";
import {useWorkspaceAccess} from "@/shared/access/useWorkspaceAccess";
import {canOpenWorkspaceHref} from "@/shared/access/routeAccess";
export function CadastroPage() {
  const {searchParams} = useModuleNavigation();
  const access=useWorkspaceAccess();
  const sections=cadastroSections.filter(section=>canOpenWorkspaceHref(access.data,section.href));
  const selected = sections.find(section=>section.id===searchParams.get("secao")) ?? (!searchParams.get('secao')?sections[0]:undefined);
  if(!selected)return null;
  const Page = selected.component;
  return <Page/>;
}
