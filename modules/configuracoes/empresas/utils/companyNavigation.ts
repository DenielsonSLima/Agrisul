export const companiesHref="/configuracoes?secao=empresas";
export const newCompanyHref=companiesHref+"&acao=nova";
export const companyHref=(id:string)=>companiesHref+"&empresa="+encodeURIComponent(id);
