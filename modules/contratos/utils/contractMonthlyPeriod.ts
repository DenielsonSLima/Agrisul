export type ContractMonthlyPeriod={from:string;to:string};
type ContractDateRange={from:string;to:string};

const monthValue=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
const validMonth=(value:string)=>/^(?:19|[2-9][0-9])[0-9]{2}-(?:0[1-9]|1[0-2])$/.test(value);

export function defaultContractMonthlyPeriod(today=new Date()):ContractMonthlyPeriod{
 const end=new Date(today.getFullYear(),today.getMonth(),1),start=new Date(end);
 start.setMonth(start.getMonth()-5);
 return {from:monthValue(start),to:monthValue(end)};
}

export function contractMonthlyPeriodFromDateRange(period:ContractDateRange):ContractMonthlyPeriod{
 return {from:period.from.slice(0,7),to:period.to.slice(0,7)};
}

export function contractMonthlyPeriodError(period:ContractMonthlyPeriod){
 if(!validMonth(period.from)||!validMonth(period.to))return 'Informe o mês inicial e o mês final.';
 if(period.from>period.to)return 'O mês inicial deve ser igual ou anterior ao mês final.';
 return '';
}

export function contractMonthlyDateFilters(period:ContractMonthlyPeriod){
 if(contractMonthlyPeriodError(period))return {from:'',to:''};
 const [year,month]=period.to.split('-').map(Number),lastDay=new Date(year,month,0).getDate();
 return {from:`${period.from}-01`,to:`${period.to}-${String(lastDay).padStart(2,'0')}`};
}

export function monthIsInContractPeriod(month:string,period?:ContractMonthlyPeriod){
 return !period||!contractMonthlyPeriodError(period)&&month>=period.from&&month<=period.to;
}

export function filterContractMonths<T extends {month:string}>(months:T[],period?:ContractMonthlyPeriod){
 return period?months.filter(item=>monthIsInContractPeriod(item.month,period)):months;
}
