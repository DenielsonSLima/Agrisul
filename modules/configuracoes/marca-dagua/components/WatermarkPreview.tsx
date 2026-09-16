import {useState} from 'react';
import NextImage from 'next/image';
import {Stamp} from 'lucide-react';
import {activeWatermarkImage,type WatermarkSettings} from '../types';
export function WatermarkPreview({settings}:{settings:WatermarkSettings}) {
  const [failedUrl,setFailedUrl]=useState<string|null>(null);
  const image=activeWatermarkImage(settings);
  const orientationLabel=settings.orientation==='portrait'?'retrato':'paisagem';
  return <section className="wm-preview-panel" aria-label="Prévia da marca d’água">
    <header className="wm-preview-heading"><h3>Prévia</h3><span>A4 · {settings.orientation==='portrait'?'Retrato':'Paisagem'}</span></header>
    <div className="wm-preview-stage"><div className={'wm-paper '+settings.orientation}>
      <div className="wm-document" aria-hidden="true"><div className="wm-document-brand">CONTROLE DE FATURAMENTO</div><div className="wm-document-title">Documento de exemplo</div><div className="wm-document-rule"/><div className="wm-document-lines">{Array.from({length:6},(_,i)=><span key={i}/>)}</div><div className="wm-document-lines second">{Array.from({length:4},(_,i)=><span key={i}/>)}</div><div className="wm-document-footer">Prévia de impressão<span>01</span></div></div>
      <div className="wm-overlay" style={{width:settings.size+'%',height:settings.size+'%',opacity:settings.opacity/100}}>
        {image.url?<NextImage key={image.url} src={image.url} alt={`Marca d’água para ${orientationLabel}`} fill unoptimized sizes="(max-width: 850px) 80vw, 45vw" onError={()=>setFailedUrl(image.url)} onLoad={()=>setFailedUrl(null)}/>:<div className="wm-placeholder"><Stamp/><span>SUA MARCA</span></div>}
      </div>
    </div></div>
    <p className="wm-preview-caption" role="status">{image.url&&failedUrl===image.url?'Não foi possível carregar a imagem. Tente recarregar a página.':image.url?'A prévia acompanha seus ajustes em tempo real.':`Selecione a imagem de ${orientationLabel} para visualizar a marca d’água.`}</p>
  </section>;
}
