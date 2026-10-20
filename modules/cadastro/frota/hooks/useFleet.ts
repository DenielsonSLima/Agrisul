import {useCadastroMutation,useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {deleteFleetVehicle,fetchFleet,persistFleetVehicle} from '../services/fleetApi';

export function useFleet(filters:{partnerId?:string}={}){return useCadastroQuery('fleet',{view:'list',...filters},signal=>fetchFleet(signal,filters));}
export function useFleetMutations(){
 const save=useCadastroMutation('fleet',persistFleetVehicle);const remove=useCadastroMutation('fleet',deleteFleetVehicle);
 return {save:save.mutateAsync,remove:remove.mutateAsync,saving:save.isPending||remove.isPending};
}
