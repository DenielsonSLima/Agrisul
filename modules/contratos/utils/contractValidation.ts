import {contractAtrPeriodTypes,contractAtrPriceTypes,contractStatuses,type ContractAtrPeriodType,type ContractAtrPriceType,type ContractInput,type ContractStatus} from '../types';
function date(value:string){if(!value)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1900)throw new Error('Informe uma data válida.');const parsed=new Date(value+'T00:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new Error('Informe uma data válida.');return value;}
export function validateContract(data:unknown):ContractInput{
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Dados inválidos.');const d=data as Record<string,unknown>;
 const read=(key:string,max:number,optional=false)=>{const v=d[key];if(optional&&(v===undefined||v===null))return '';if(typeof v!=='string'||v.trim().length>max)throw new Error('Confira os campos do contrato.');return v.trim();};
 const title=read('title',150);if(title.length<2)throw new Error('Informe o nome do contrato.');
 const companyId=read('companyId',100),clientId=read('clientId',100),typeId=read('typeId',100);if(!companyId||!clientId||!typeId)throw new Error('Selecione a empresa, o cliente e o tipo de contrato.');
 const status=read('status',20);if(!contractStatuses.includes(status as ContractStatus))throw new Error('Selecione uma situação válida.');
 const atrPriceType=read('atrPriceType',10);if(!contractAtrPriceTypes.includes(atrPriceType as ContractAtrPriceType))throw new Error('Selecione se a cotação do ATR será bruta ou líquida.');
 const atrPeriodType=read('atrPeriodType',12);if(!contractAtrPeriodTypes.includes(atrPeriodType as ContractAtrPeriodType))throw new Error('Selecione se a cotação do ATR será mensal ou acumulada.');
 const startDate=date(read('startDate',10,true)),endDate=date(read('endDate',10,true));if(startDate&&endDate&&endDate<startDate)throw new Error('A data final deve ser igual ou posterior à inicial.');
 let value=read('value',16,true).replace(',','.');if(value){if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(value))throw new Error('Informe um valor válido, com até duas casas decimais.');const [whole,fraction='']=value.split('.');value=String(Number(whole))+'.'+fraction.padEnd(2,'0');}
 let contractedVolume=read('contractedVolume',18).replace(',','.');if(!/^\d{1,12}(?:\.\d{1,3})?$/.test(contractedVolume)||Number(contractedVolume)<=0)throw new Error('Informe um volume válido, com até três casas decimais.');const [volumeWhole,volumeFraction='']=contractedVolume.split('.');contractedVolume=String(Number(volumeWhole))+'.'+volumeFraction.padEnd(3,'0');
 return {title,contractNumber:read('contractNumber',100,true),companyId,clientId,typeId,status:status as ContractStatus,startDate,endDate,contractedVolume,atrPriceType:atrPriceType as ContractAtrPriceType,atrPeriodType:atrPeriodType as ContractAtrPeriodType,value,notes:read('notes',4000,true)};
}
