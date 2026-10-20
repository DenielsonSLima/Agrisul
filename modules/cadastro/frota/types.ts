export type FleetVehicle={
 id:string;
 internalCode:string;
 model:string;
 brand:string;
 description:string;
 partnerId:string|null;
 partnerName:string;
 plate:string;
 kind:'truck'|'trailer'|null;
 tareKg:string|null;
 createdAt:string;
 updatedAt:string;
};
export type FleetVehicleInput=Pick<FleetVehicle,'internalCode'|'model'|'brand'|'description'> & Partial<Pick<FleetVehicle,'partnerId'|'plate'|'kind'|'tareKg'>> & {id?:string};
export type FleetCollection={vehicles:FleetVehicle[];canManage:boolean};
export const emptyFleetVehicle:FleetVehicleInput={internalCode:'',model:'',brand:'',description:'',partnerId:null,plate:'',kind:null,tareKg:null};
