import type {ReportIssuer} from "./types";

export function ReportFooter({issuer,issuedAt,pageLabel="Página 1 de 1"}:{issuer:ReportIssuer;issuedAt:Date|string;pageLabel?:string}){
 const date=typeof issuedAt==="string"?new Date(issuedAt):issuedAt;
 const formatted=Number.isNaN(date.getTime())?"Data indisponível":new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(date);
 return <footer className="report-document-footer"><span>Emitido por <strong>{issuer.name||issuer.email}</strong> em {formatted}</span><span>{pageLabel}</span></footer>;
}
