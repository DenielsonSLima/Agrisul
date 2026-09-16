import {Loader2,RefreshCw} from "lucide-react";
import {useSettings} from "../../hooks/useSettings";
import {SettingsForm} from "../../forms/SettingsForm";

export function PerfilPage(){
 const model=useSettings();
 return <section className="companies-section"><div className="companies-heading"><div><h2>Meu perfil</h2><p>Gerencie os dados e as preferências da sua conta.</p></div></div>
  {model.authRequired?<p>Entre na sua conta para acessar seu perfil.</p>:model.loading?<p role="status"><Loader2 size={18} className="animate-spin"/>Carregando perfil…</p>:model.error?<div role="alert"><p>{model.error}</p><button className="btn" onClick={model.reload}><RefreshCw size={16}/>Tentar novamente</button></div>:model.settings&&<SettingsForm settings={model.settings} onSave={model.save}/>} 
 </section>;
}
