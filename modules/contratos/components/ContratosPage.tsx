import {useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {ContractList} from './ContractList';
import {ContractCreateDialog} from './ContractCreateDialog';
import {ContractDetail} from './ContractDetail';

export function ContratosPage(){
 const {searchParams}=useModuleNavigation();const id=searchParams.get('contrato');
 if(id)return <ContractDetail key={id+':'+searchParams.get('editar')+':'+searchParams.get('salvo')} id={id} editing={searchParams.get('editar')==='1'} saved={searchParams.get('salvo')==='1'}/>;
 return <><ContractList/>{searchParams.get('novo')==='1'&&<ContractCreateDialog/>}</>;
}
