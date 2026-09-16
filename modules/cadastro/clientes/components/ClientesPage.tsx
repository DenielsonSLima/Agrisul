import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {ClientList} from './ClientList';
import {ClientDetail} from './ClientDetail';
import {ClientBreadcrumb} from './ClientBreadcrumb';
import {ClientForm} from '../forms/ClientForm';
export function ClientesPage(){
  const {searchParams}=useModuleNavigation();const id=searchParams.get('cliente');
  if(searchParams.get('novo')==='1')return <section className="clients-workspace"><ClientBreadcrumb name="Novo parceiro"/><div className="companies-heading"><div><h2>Novo parceiro</h2><p>Consulte o CNPJ e revise os dados do cliente.</p></div></div><ClientForm/></section>;
  if(id)return <ClientDetail key={id+':'+searchParams.get('editar')+':'+searchParams.get('salvo')} id={id} editing={searchParams.get('editar')==='1'} saved={searchParams.get('salvo')==='1'}/>;
  return <ClientList/>;
}
