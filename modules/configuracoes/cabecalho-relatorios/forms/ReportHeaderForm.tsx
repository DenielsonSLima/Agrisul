import {RectangleHorizontal,RectangleVertical} from "lucide-react";
import {Choice} from "@/shared/components/Common";
import {RadioGroup,RadioGroupItem} from "@/components/ui/radio-group";
import {Switch} from "@/components/ui/switch";
import type {Company} from "../../empresas/types";
import type {ReportHeaderVariant,ReportOrientation} from "@/shared/reporting";
import {activeReportHeader,type ReportHeaderSettings} from "../types";

export function ReportHeaderForm({settings,companies,disabled,onChange,onVariantChange}:{settings:ReportHeaderSettings;companies:Company[];disabled:boolean;onChange:(patch:Partial<Pick<ReportHeaderSettings,"orientation"|"defaultCompanyId">>)=>void;onVariantChange:(orientation:ReportOrientation,patch:Partial<ReportHeaderVariant>)=>void}){
 const active=activeReportHeader(settings);const patch=(value:Partial<ReportHeaderVariant>)=>onVariantChange(settings.orientation,value);
 return <aside className="report-controls" aria-label="Configuração do cabeçalho">
  <section className="report-control-section"><h3 id="report-orientation">Orientação</h3><RadioGroup aria-labelledby="report-orientation" className="report-orientations" value={settings.orientation} disabled={disabled} onValueChange={value=>onChange({orientation:value as ReportOrientation})}>
   {[{value:"portrait",label:"Retrato",Icon:RectangleVertical},{value:"landscape",label:"Paisagem",Icon:RectangleHorizontal}].map(({value,label,Icon})=><label key={value} className={`report-orientation ${settings.orientation===value?"selected":""}`}><RadioGroupItem value={value}/><Icon size={23}/><span>{label}</span></label>)}
  </RadioGroup><p>As duas orientações mantêm ajustes independentes.</p></section>
  <section className="report-control-section"><h3>Empresa padrão</h3><Choice label="Empresa padrão" value={settings.defaultCompanyId??"__primary__"} disabled={disabled} onChange={value=>onChange({defaultCompanyId:value==="__primary__"?null:value})} items={[{value:"__primary__",label:"Empresa principal (automática)"},...companies.map(company=>({value:company.id,label:company.name}))]}/><p>Relatórios vinculados a uma empresa poderão substituir este padrão.</p></section>
  <section className="report-control-section"><h3>Composição em {settings.orientation==="portrait"?"retrato":"paisagem"}</h3>
   <label className="report-control-field"><span>Modelo</span><Choice label="Modelo do cabeçalho" value={active.variant} disabled={disabled} onChange={value=>patch({variant:value as ReportHeaderVariant["variant"]})} items={[{value:"detailed",label:"Detalhado"},{value:"compact",label:"Compacto"}]}/><small className="field-help">O compacto reduz somente fontes e espaçamentos. A ordem institucional permanece igual.</small></label>
   <label className="report-control-field"><span>Posição da identidade</span><Choice label="Posição da identidade" value={active.logoAlignment} disabled={disabled} onChange={value=>patch({logoAlignment:value as ReportHeaderVariant["logoAlignment"]})} items={[{value:"left",label:"À esquerda"},{value:"center",label:"Centralizada"},{value:"right",label:"À direita"}]}/></label>
   <div className="report-switch-row"><span><strong>Exibir CNPJ</strong><small>Inclui o documento da empresa.</small></span><Switch aria-label="Exibir CNPJ no cabeçalho" checked={active.showCnpj} disabled={disabled} onCheckedChange={checked=>patch({showCnpj:checked})}/></div>
   <div className="report-switch-row"><span><strong>Exibir contato</strong><small>Telefone, e-mail e localização.</small></span><Switch aria-label="Exibir contato no cabeçalho" checked={active.showContact} disabled={disabled} onCheckedChange={checked=>patch({showContact:checked})}/></div>
  </section>
 </aside>;
}
