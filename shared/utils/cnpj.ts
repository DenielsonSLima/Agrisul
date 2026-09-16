export const normalizeCnpj=(s:string)=>s.toUpperCase().replace(/[.\/\-\s]/g,"");
export const validCnpj=(s:string)=>/^[A-Z0-9]{12}\d{2}$/.test(s);
export const formatCnpj=(s:string)=>normalizeCnpj(s).replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/,"$1.$2.$3/$4-$5");
