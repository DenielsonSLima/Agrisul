import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {ContractTypeEditor,ContractTypesList} from './ContractTypesPage';
import {TypeBreadcrumb} from './TypeBreadcrumb';
import {ContractTypeForm} from '../forms/ContractTypeForm';
export function ContratosCadastroPage(){const {searchParams}=useModuleNavigation();const id=searchParams.get('tipo');const create=searchParams.get('novo');
  if(create)return <section><TypeBreadcrumb name="Novo tipo"/><div className="companies-heading"><div><h2>Novo tipo de contrato</h2><p>Defina um nome e organize suas etapas.</p></div></div><ContractTypeForm key={create} initialName={create==='manual'?'Contrato manual':create==='semimecanizado'?'Contrato semimecanizado':''}/></section>;
  return id?<ContractTypeEditor key={id+':'+searchParams.get('salvo')} id={id} saved={searchParams.get('salvo')==='1'}/>:<ContractTypesList/>;
}
