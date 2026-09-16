import {useModuleNavigation} from "@/shared/navigation/ModuleNavigation";
import {cadastroSections} from "../sections";
export function CadastroPage() {
  const {searchParams} = useModuleNavigation();
  const selected = cadastroSections.find(section=>section.id===searchParams.get("secao")) ?? cadastroSections[0];
  const Page = selected.component;
  return <Page/>;
}
