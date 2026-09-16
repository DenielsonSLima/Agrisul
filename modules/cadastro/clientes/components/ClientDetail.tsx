import {Building2,MapPin,Phone,Pencil,Check} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {formatCnpj} from '@/shared/utils/cnpj';
import {useClients} from '../hooks/useClients';
import {clientHref,clientAddress,clientLocation} from '../utils/clientFormat';
import {ClientBreadcrumb} from './ClientBreadcrumb';
import {ClientLoadState} from './ClientLoadState';
import {ClientForm} from '../forms/ClientForm';
export function ClientDetail({id,editing,saved}:{id:string;editing:boolean;saved:boolean}){
  const m=useClients(id);const c=m.client;
  if(m.loading||m.error||!c)return <section><ClientBreadcrumb name="Detalhes do cliente"/><ClientLoadState {...m} onRetry={m.reload}/></section>;
  const value=(label:string,text:string)=><div className="client-detail-field"><dt>{label}</dt><dd>{text||'Não informado'}</dd></div>;
  return <section className="clients-workspace"><ClientBreadcrumb name={c.legalName}/><div className="companies-heading client-detail-heading"><div><h2>{editing?'Editar parceiro':c.legalName}</h2><p>{editing?c.legalName:formatCnpj(c.cnpj)}</p></div>{!editing&&<ModuleLink className="btn" href={clientHref(c.id)+'&editar=1'}><Pencil size={16}/>Editar cadastro</ModuleLink>}</div>
    {editing?<ClientForm client={c}/>:<>{saved&&<p className="company-saved" role="status"><Check size={16}/>Cadastro salvo.</p>}<div className="client-detail-grid"><section className="client-detail-panel"><h3><Building2 size={18}/>Identificação</h3><dl>{value('Razão social',c.legalName)}{value('Nome fantasia',c.tradeName)}{value('CNPJ',formatCnpj(c.cnpj))}</dl></section><section className="client-detail-panel"><h3><MapPin size={18}/>Endereço</h3><dl>{value('Cidade / UF',clientLocation(c))}{value('Endereço completo',clientAddress(c))}{value('CEP',c.zipCode)}</dl></section><section className="client-detail-panel"><h3><Phone size={18}/>Contato</h3><dl>{value('Telefone',c.phone)}{value('E-mail',c.email)}</dl></section></div></>}
  </section>;
}
