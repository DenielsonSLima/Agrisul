import type {ClientInput} from '../types';
export const clientLocation=(c:ClientInput)=>[c.city,c.state].filter(Boolean).join(' / ');
export const clientAddress=(c:ClientInput)=>[[c.street,c.number].filter(Boolean).join(', '),c.complement,c.district].filter(Boolean).join(' · ');
export const clientsHref='/cadastro?secao=clientes';
export const clientHref=(id:string)=>clientsHref+'&cliente='+encodeURIComponent(id);
