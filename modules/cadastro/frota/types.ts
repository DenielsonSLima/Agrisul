export type FleetVehicle={
 id:string;
 internalCode:string;
 model:string;
 brand:string;
 description:string;
 createdAt:string;
 updatedAt:string;
};
export type FleetVehicleInput=Pick<FleetVehicle,'internalCode'|'model'|'brand'|'description'> & {id?:string};
export type FleetCollection={vehicles:FleetVehicle[];canManage:boolean};
export const emptyFleetVehicle:FleetVehicleInput={internalCode:'',model:'',brand:'',description:''};
