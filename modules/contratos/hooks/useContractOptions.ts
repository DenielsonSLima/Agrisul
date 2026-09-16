import {useClients} from '@/modules/cadastro/clientes/hooks/useClients';
import {useContractTypes} from '@/modules/cadastro/contratos/hooks/useContractTypes';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
export function useContractOptions(){
  const clients=useClients();
  const types=useContractTypes();
  const companies=useWorkspaceCompany();
  return {
    clients:clients.clients,
    types:types.types,
    companies:companies.companies,
    activeCompany:companies.activeCompany,
    loading:clients.loading||types.loading||companies.loading,
    error:clients.error||types.error||companies.error,
    status:clients.status||types.status,
    reload:async()=>{await Promise.all([clients.reload(),types.reload(),companies.reload()]);},
  };
}
