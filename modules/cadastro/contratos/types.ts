export type ContractStage={id:string;name:string};
export type ContractTypeInput={name:string;stages:ContractStage[]};
export type ContractType=ContractTypeInput&{id:string;createdAt:string;updatedAt:string};
