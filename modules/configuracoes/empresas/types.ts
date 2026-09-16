import type {CompanyDetails} from "@/shared/types/companyDetails";
export type {CompanyDetails} from "@/shared/types/companyDetails";
export type Company=CompanyDetails&{id:string;name:string;isPrimary:boolean;logoKey:string|null;logoName:string;logoUrl:string|null;createdAt:string;updatedAt:string};
export type CompanyInput=CompanyDetails&{isPrimary:boolean};
export type CompanyLogoChange={file:File|null;remove:boolean;previousKey:string|null};
