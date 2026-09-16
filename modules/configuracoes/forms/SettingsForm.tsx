import {useState} from "react";
import type {Settings} from "@/shared/types";
import {Field} from "@/shared/components/Common";
import {Switch} from "@/components/ui/switch";
import {Loader2} from "lucide-react";
import {notifications} from "@/shared/feedback";
export function SettingsForm({settings,onSave}:{settings:Settings;onSave:(s:Settings)=>Promise<void>}){
 const[compact,setCompact]=useState(settings.compact);const[saving,setSaving]=useState(false);const[error,setError]=useState("");
 return <form onSubmit={async e=>{e.preventDefault();if(saving)return;const d=new FormData(e.currentTarget);setSaving(true);setError("");try{await onSave({name:String(d.get("name")),company:String(d.get("company")),email:settings.email,compact});notifications.saved("Suas preferências foram atualizadas.")}catch(e){const message=(e as Error).message;setError(message);notifications.error(message)}finally{setSaving(false)}}}>
 <fieldset disabled={saving} className="company-fieldset"><div className="settings-section"><h2>Informações gerais</h2><p>Personalize a identificação do seu espaço.</p><div className="form-grid"><Field label="Seu nome"><input name="name" required maxLength={150} defaultValue={settings.name}/></Field><Field label="Espaço de trabalho"><input name="company" required maxLength={200} defaultValue={settings.company}/></Field></div><Field label="E-mail da conta"><input name="email" type="email" value={settings.email} readOnly aria-readonly="true"/></Field><p className="field-help">Este é o e-mail usado para entrar na sua conta.</p></div><div className="settings-section"><h2>Preferências de exibição</h2><div className="switch-row"><div><strong>Tabelas compactas</strong><p>Exiba mais registros com menos espaço entre as linhas.</p></div><Switch checked={compact} onCheckedChange={setCompact} aria-label="Tabelas compactas"/></div></div></fieldset>
 {error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="btn primary" disabled={saving}>{saving&&<Loader2 size={16} className="animate-spin"/>}{saving?"Salvando…":"Salvar alterações"}</button></div></form>;
}
