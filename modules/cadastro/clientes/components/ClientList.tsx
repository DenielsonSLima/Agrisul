import {useState} from 'react';
import {Plus,Users,Search} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {LocalSearch} from '@/shared/components/Common';
import {normalize} from '@/shared/utils/format';
import {useClients} from '../hooks/useClients';
import {clientsHref} from '../utils/clientFormat';
import {ClientBreadcrumb} from './ClientBreadcrumb';
import {ClientCard} from './ClientCard';
import {ClientLoadState} from './ClientLoadState';
export function ClientList(){
  const m=useClients();const [query,setQuery]=useState('');
  const q=normalize(query);const digits=query.replace(/\D/g,'');
  const filtered=m.clients.filter(c=>normalize([c.legalName,c.tradeName,c.cnpj,c.city,c.state,c.phone,c.email].join(' ')).includes(q)||(digits.length>2&&c.cnpj.includes(digits)));
  return <section className="clients-workspace"><ClientBreadcrumb/><div className="companies-heading"><div><h2>Clientes</h2><p>Cadastre e consulte seus parceiros.</p></div>{m.status!==401&&<ModuleLink className="btn company-primary" href={clientsHref+'&novo=1'}><Plus size={17}/>Novo parceiro</ModuleLink>}</div>
    {m.loading||m.error?<ClientLoadState {...m} onRetry={m.reload}/>:!m.clients.length?<div className="company-empty"><span className="company-empty-icon"><Users size={25}/></span><h3>Cadastre seu primeiro parceiro</h3><p>Consulte o CNPJ para preencher os dados e revise antes de salvar.</p><ModuleLink className="btn company-primary" href={clientsHref+'&novo=1'}><Plus size={16}/>Novo parceiro</ModuleLink></div>:<><div className="companies-toolbar"><LocalSearch value={query} onChange={setQuery} placeholder="Buscar razão social, CNPJ ou cidade"/><span>{filtered.length} de {m.clients.length} cliente{m.clients.length!==1?'s':''}</span></div><div className="client-grid">{filtered.map(client=><ClientCard key={client.id} client={client}/>)}</div>{!filtered.length&&<div className="client-loading"><Search size={19}/>Nenhum cliente encontrado.</div>}</>}
  </section>;
}
