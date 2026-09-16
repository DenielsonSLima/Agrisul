import {Building2,ArrowUpRight,MapPin,Phone,Mail} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {formatCnpj} from '@/shared/utils/cnpj';
import type {Client} from '../types';
import {clientHref,clientAddress,clientLocation} from '../utils/clientFormat';
export function ClientCard({client}:{client:Client}){
  const address=clientAddress(client);const location=clientLocation(client);
  return <ModuleLink href={clientHref(client.id)} className="client-card" aria-label={'Abrir cliente '+client.legalName}>
    <div className="client-card-top"><span className="client-card-icon"><Building2 size={20} strokeWidth={1.6}/></span><ArrowUpRight size={16}/></div>
    <h3 title={client.legalName}>{client.legalName}</h3><p className="client-card-cnpj">{formatCnpj(client.cnpj)}</p>
    <div className="client-card-address"><div className="client-card-line"><MapPin size={14}/><strong title={location}>{location||'Cidade / UF não informadas'}</strong></div><p title={address}>{address||'Endereço não informado'}</p></div>
    <div className="client-card-contact"><div className="client-card-line"><Phone size={13}/><span title={client.phone}>{client.phone||'Telefone não informado'}</span></div><div className="client-card-line"><Mail size={13}/><span title={client.email}>{client.email||'E-mail não informado'}</span></div></div>
  </ModuleLink>;
}
