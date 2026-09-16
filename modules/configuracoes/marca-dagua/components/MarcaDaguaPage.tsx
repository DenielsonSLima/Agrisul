import Link from "next/link";
import {Loader2,Save,RefreshCw} from 'lucide-react';
import {useConfirmation} from '@/shared/feedback';
import {useWatermark} from '../hooks/useWatermark';
import {WatermarkControls} from '../forms/WatermarkControls';
import {WatermarkPreview} from './WatermarkPreview';
import {activeWatermarkImage} from '../types';
export function MarcaDaguaPage() {
  const m=useWatermark();
  const confirm=useConfirmation();
  const image=activeWatermarkImage(m.settings);const orientationLabel=m.settings.orientation==='portrait'?'retrato':'paisagem';
  const remove=async()=>{
    if(!image.url)return;
    const accepted=await confirm({title:`Remover imagem de ${orientationLabel}?`,description:`A imagem usada em documentos no formato ${orientationLabel} será removida quando você salvar as alterações. A imagem da outra orientação será preservada.`,confirmLabel:'Remover imagem',tone:'destructive'});
    if(accepted)m.remove();
  };
  return <section className="wm-workspace">
    <div className="companies-heading"><div><h2>Marca d’água</h2><p>Ajuste a apresentação da sua marca nos documentos.</p></div>
      {m.authRequired?<Link className="btn company-primary" href="/login?returnTo=%2Fconfiguracoes%3Fsecao%3Dmarca-dagua" >Entrar para salvar</Link>:<button className="btn company-primary" onClick={m.save} disabled={m.loading||m.saving||m.processing||!!m.loadError||!m.dirty}>{m.saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {m.saving?'Salvando…':'Salvar alterações'}</button>}
    </div>
    {m.error&&<p className="form-error" role="alert">{m.error}</p>}
    {m.loadError&&<div className="wm-load-error" role="alert"><span>{m.loadError}</span><button className="btn small" onClick={m.reload}><RefreshCw size={14}/>Tentar novamente</button></div>}
    {m.loading?<div className="wm-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando marca d’água…</div>:<div className="wm-layout"><WatermarkControls settings={m.settings} disabled={m.authRequired||m.saving||!!m.loadError} processing={m.processing} onChange={m.change} onChoose={m.choose} onRemove={()=>{void remove();}}/><WatermarkPreview settings={m.settings}/></div>}
  </section>;
}
