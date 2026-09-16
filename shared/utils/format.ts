export const money=(n:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0}).format(n);
export const dateLabel=(s:string)=>new Date(s+"T12:00:00").toLocaleDateString("pt-BR");
export const initials=(s:string)=>s.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
export const normalize=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
