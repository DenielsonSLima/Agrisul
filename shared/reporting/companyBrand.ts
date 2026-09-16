import type {ReportCompanyBrand,ReportHeaderVariant} from './types';

export function formatReportCnpj(value:string){
 const digits=value.replace(/\D/g,'');
 return digits.length===14?digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):value;
}

export function formatReportZipCode(value:string){
 const digits=value.replace(/\D/g,'');
 return digits.length===8?digits.replace(/^(\d{5})(\d{3})$/,'$1-$2'):value;
}

export function formatReportPhone(value:string){
 const digits=value.replace(/\D/g,'');
 if(digits.length===10)return digits.replace(/^(\d{2})(\d{4})(\d{4})$/,'($1) $2-$3');
 if(digits.length===11)return digits.replace(/^(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');
 return value;
}

export function getReportCompanyDetails(company:ReportCompanyBrand|null,settings:ReportHeaderVariant){
 if(!company)return {cnpj:'',address:'',district:'',city:'',state:'',zipCode:'',contact:''};
 const address=settings.showContact?[
  [company.street,company.number].filter(Boolean).join(', '),company.complement,
 ].filter(Boolean).join(' · '):'';
 return {
  cnpj:settings.showCnpj&&company.cnpj?`CNPJ ${formatReportCnpj(company.cnpj)}`:'',
  address,
  district:settings.showContact?company.district:'',
  city:settings.showContact?company.city:'',
  state:settings.showContact?company.state:'',
  zipCode:settings.showContact&&company.zipCode?formatReportZipCode(company.zipCode):'',
  contact:settings.showContact?[company.phone?formatReportPhone(company.phone):'',company.email].filter(Boolean).join(' · '):'',
 };
}
