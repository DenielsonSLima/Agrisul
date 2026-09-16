import {useRef} from 'react';
import {Upload,ImagePlus,Trash2,RectangleVertical,RectangleHorizontal} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {activeWatermarkImage,type WatermarkSettings} from '../types';
type Props={settings:WatermarkSettings;disabled:boolean;processing:boolean;onChange:(patch:Partial<WatermarkSettings>)=>void;onChoose:(file:File)=>void;onRemove:()=>void};
export function WatermarkControls({settings,disabled,processing,onChange,onChoose,onRemove}:Props) {
  const input=useRef<HTMLInputElement>(null);
  const image=activeWatermarkImage(settings);
  const orientationLabel=settings.orientation==='portrait'?'retrato':'paisagem';
  return <div className="wm-controls">
    <section className="wm-control-section"><h3>Imagem para {orientationLabel}</h3>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label={`Imagem da marca d’água para ${orientationLabel}`} disabled={disabled||processing} onChange={event=>{const file=event.target.files?.[0];if(file)onChoose(file);event.target.value='';}}/>
      <button className="wm-upload" type="button" disabled={disabled||processing} onClick={()=>input.current?.click()}><ImagePlus size={24}/><strong>{processing?'Abrindo imagem…':image.url?`Trocar imagem de ${orientationLabel}`:`Selecionar imagem de ${orientationLabel}`}</strong><span>PNG, JPG ou WebP · até 3 MB</span></button>
      {image.url&&<div className="wm-file"><Upload size={14}/><span title={image.name}>{image.name}</span><button className="icon-btn" type="button" disabled={disabled||processing} aria-label={`Remover imagem de ${orientationLabel}`} onClick={onRemove}><Trash2 size={15}/></button></div>}
      <p className="wm-help">Retrato e paisagem usam arquivos independentes. Prefira PNG com fundo transparente.</p>
    </section>
    <section className="wm-control-section"><h3 id="wm-orientation">Orientação da página</h3>
      <RadioGroup className="wm-orientations" aria-labelledby="wm-orientation" value={settings.orientation} disabled={disabled} onValueChange={value=>onChange({orientation:value as WatermarkSettings['orientation']})}>
        {[{value:'portrait',label:'Retrato',Icon:RectangleVertical},{value:'landscape',label:'Paisagem',Icon:RectangleHorizontal}].map(({value,label,Icon})=><label className={'wm-orientation '+(settings.orientation===value?'selected':'')} key={value}><RadioGroupItem value={value} className="wm-radio"/><Icon size={24} strokeWidth={1.5}/><span>{label}</span></label>)}
      </RadioGroup>
    </section>
    <section className="wm-control-section wm-range-section"><div className="wm-control-label"><h3 id="wm-opacity">Opacidade</h3><output>{settings.opacity}%</output></div><div ref={node=>{node?.querySelector('[role="slider"]')?.setAttribute("aria-labelledby","wm-opacity");}}><Slider aria-labelledby="wm-opacity" min={0} max={100} step={1} value={[settings.opacity]} disabled={disabled} onValueChange={value=>onChange({opacity:value[0]})}/></div><div className="wm-range-labels"><span>Transparente</span><span>Visível</span></div></section>
    <section className="wm-control-section wm-range-section"><div className="wm-control-label"><h3 id="wm-size">Tamanho</h3><output>{settings.size}%</output></div><div ref={node=>{node?.querySelector('[role="slider"]')?.setAttribute("aria-labelledby","wm-size");}}><Slider aria-labelledby="wm-size" min={10} max={100} step={1} value={[settings.size]} disabled={disabled} onValueChange={value=>onChange({size:value[0]})}/></div><p className="wm-help">A imagem mantém sua proporção e fica centralizada na página.</p></section>
  </div>;
}
