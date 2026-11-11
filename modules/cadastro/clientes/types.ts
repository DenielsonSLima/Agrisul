import type {CompanyDetails} from '@/shared/types/companyDetails';
export type ClientInput=CompanyDetails&{destinationCode?:string};
export type Client=ClientInput&{id:string;createdAt:string;updatedAt:string};
export const emptyClient:ClientInput={cnpj:'',legalName:'',tradeName:'',street:'',number:'',complement:'',district:'',city:'',state:'',zipCode:'',phone:'',email:'',destinationCode:''};
