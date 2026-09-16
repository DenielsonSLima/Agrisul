import {useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {fetchContractLoads} from '../services/contractApi';
import type {ContractLoadFilters} from '../types';

export const defaultLoadFilters:ContractLoadFilters={search:'',from:'',to:'',groupBy:'month'};
export function useContractLoads(contractId:string,filters:ContractLoadFilters,enabled=true){
 const {activeCompanyId}=useWorkspaceCompany();
 // Refresh snapshots created before filtered financial KPIs were available.
 return useCadastroQuery('contracts',{view:'loads',snapshotVersion:3,contractId,companyId:activeCompanyId,...filters},
  signal=>fetchContractLoads(contractId,activeCompanyId,filters,signal),enabled&&!!activeCompanyId);
}
