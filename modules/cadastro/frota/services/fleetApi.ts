import {rpcRequest} from '@/shared/supabase/rpc';
import type {FleetCollection,FleetVehicle,FleetVehicleInput} from '../types';

export const fetchFleet=(signal:AbortSignal)=>rpcRequest<FleetCollection>('fleet','list',{},signal);
export const persistFleetVehicle=async(input:FleetVehicleInput)=>(await rpcRequest<{vehicle:FleetVehicle}>('fleet','save',input)).vehicle;
export const deleteFleetVehicle=(id:string)=>rpcRequest<{id:string;deleted:true}>('fleet','delete',{id});
