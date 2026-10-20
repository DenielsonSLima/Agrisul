import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Info, Loader2, Plus, Save, Truck} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {useWeighingMutations} from '../hooks/useWeighings';
import {weightInput} from '../utils/presentation';
import type {WeighingControl, WeighingEntry, WeighingComponentInput} from '../types';

function emptyComponents(): WeighingComponentInput[] {
  return ['truck', 'trailer', 'trailer'].map(kind => ({kind: kind as 'truck' | 'trailer', fleetNumber: '', plate: '', tareKg: '', grossKg: '', partnerNetKg: ''}));
}

export function WeighingEntryDialog({control, entry, lastDate, onClose}: {control: WeighingControl; entry?: WeighingEntry; lastDate: string; onClose: () => void}) {
  const {saveEntry} = useWeighingMutations();
  const [weighedAt, setWeighedAt] = useState(entry?.weighedAt ?? lastDate);
  const [weighedTime, setWeighedTime] = useState(entry?.weighedTime ?? '');
  const [ticket, setTicket] = useState(entry?.ticket ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [mode, setMode] = useState<'combined' | 'individual'>(entry?.trailerGrossMode ?? 'combined');
  const [combined, setCombined] = useState(weightInput(entry?.combinedTrailerGrossKg));
  const [components, setComponents] = useState<WeighingComponentInput[]>(() => entry ? entry.components.map(component => ({fleetNumber: component.fleetNumber, plate: component.plate, kind: component.kind, tareKg: weightInput(component.tareKg), grossKg: weightInput(component.grossKg), partnerNetKg: weightInput(component.partnerNetKg)})) : emptyComponents());
  const [error, setError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  const mounted = useRef(true), inFlight = useRef(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const close = () => {if (!inFlight.current) onClose();};
  const changeComponent = (index: number, field: keyof WeighingComponentInput, value: string) => setComponents(current => current.map((component, position) => position === index ? {...component, [field]: value} : component));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    if (!weighedAt) {setError('Informe a data da pesagem.'); return;}
    const keepOpen = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'another';
    setError(''); inFlight.current = true;
    try {
      await saveEntry.mutateAsync({controlId: control.id, id: entry?.id, input: {
        weighedAt, weighedTime, ticket, notes, trailerGrossMode: mode,
        combinedTrailerGrossKg: mode === 'combined' ? combined.trim() || null : null,
        components: components.map((component, index) => ({...component, tareKg: component.tareKg?.trim() || null,
          grossKg: index > 0 && mode === 'combined' ? null : component.grossKg?.trim() || null, partnerNetKg: component.partnerNetKg?.trim() || null})),
      }});
      if (!mounted.current) return;
      if (entry) notifications.updated('A viagem e o comparativo foram atualizados.');
      else notifications.created('A viagem foi adicionada ao controle de pesagem.');
      if (keepOpen && !entry) {
        setComponents(current => current.map(component => ({...component, grossKg: '', partnerNetKg: ''})));
        setCombined(''); setTicket(''); setNotes(''); setWeighedTime(''); setSavedCount(count => count + 1);
      } else onClose();
    } catch (reason) {if (mounted.current) {const message = (reason as Error).message; setError(message); notifications.error(message);}}
    finally {inFlight.current = false;}
  }
  return <Dialog open onOpenChange={open => {if (!open) close();}}><DialogContent className="form-modal weighing-entry-dialog" onEscapeKeyDown={event => {if (saveEntry.isPending) event.preventDefault();}} onPointerDownOutside={event => {if (saveEntry.isPending) event.preventDefault();}}>
    <DialogHeader><DialogTitle><Truck size={21}/>{entry ? 'Editar viagem' : 'Adicionar viagem'}</DialogTitle><DialogDescription>Transcreva a ficha de campo em quilogramas. Cada viagem reúne um caminhão e dois reboques.</DialogDescription></DialogHeader>
    <form onSubmit={submit}>
      <fieldset className="company-fieldset" disabled={saveEntry.isPending}>
        <div className="weighing-entry-meta"><Field label="Data da pesagem *"><input required type="date" min={control.startDate} max="9998-12-31" value={weighedAt} onChange={event => setWeighedAt(event.target.value)} autoFocus/></Field><Field label="Hora"><input type="time" value={weighedTime} onChange={event => setWeighedTime(event.target.value)}/></Field><Field label="Ticket / comprovante"><input maxLength={100} placeholder="Opcional" value={ticket} onChange={event => setTicket(event.target.value)}/></Field></div>
        <div className="weighing-mode"><span>Peso bruto dos reboques</span><div role="group" aria-label="Forma de pesagem dos reboques"><button type="button" aria-pressed={mode === 'combined'} onClick={() => setMode('combined')}>Pesados juntos</button><button type="button" aria-pressed={mode === 'individual'} onClick={() => setMode('individual')}>Pesados separados</button></div></div>
        {mode === 'combined' && <div className="weighing-combined"><Field label="Bruto conjunto dos dois reboques (kg)"><input inputMode="decimal" maxLength={30} placeholder="Ex.: 55.220" value={combined} onChange={event => setCombined(event.target.value)}/></Field><p><Info size={16}/>O bruto conjunto será dividido igualmente entre os dois reboques, como na planilha.</p></div>}
        <div className="weighing-entry-components">{components.map((component, index) => <section key={index} className="weighing-component"><h3>{index === 0 ? <><Truck size={17}/>Caminhão</> : <>Reboque {index}</>}</h3><div className="weighing-component-fields">
          <Field label="Nº da frota"><input maxLength={60} value={component.fleetNumber} onChange={event => changeComponent(index, 'fleetNumber', event.target.value)} placeholder="Ex.: 133"/></Field>
          <Field label="Placa *"><input required maxLength={12} className="weighing-plate" value={component.plate} onChange={event => changeComponent(index, 'plate', event.target.value.toUpperCase())} placeholder="ABC1D23"/></Field>
          <Field label="Tara AGRISUL (kg)"><input inputMode="decimal" maxLength={30} value={component.tareKg ?? ''} onChange={event => changeComponent(index, 'tareKg', event.target.value)} placeholder="Ex.: 16.400"/></Field>
          <Field label="Bruto AGRISUL (kg)">{index > 0 && mode === 'combined' ? <div className="weighing-rateio">½ do bruto conjunto</div> : <input inputMode="decimal" maxLength={30} value={component.grossKg ?? ''} onChange={event => changeComponent(index, 'grossKg', event.target.value)} placeholder="Ex.: 38.860"/>}</Field>
          <Field label={`Líquido ${control.partnerName} (kg)`}><input inputMode="decimal" maxLength={30} value={component.partnerNetKg ?? ''} onChange={event => changeComponent(index, 'partnerNetKg', event.target.value)} placeholder="Preencher depois"/></Field>
        </div></section>)}</div>
        <p className="weighing-help"><Info size={15}/>Líquidos, subtotais e diferenças são preenchidos ao salvar. Você pode salvar com pesos pendentes e completar o comparativo depois.</p>
        <Field label="Observações da viagem"><textarea maxLength={2000} rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Opcional"/></Field>
      </fieldset>
      {!!savedCount && <p className="weighing-saved" role="status">Viagem salva. Frota, placas e taras foram mantidas para agilizar o próximo lançamento.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="btn" disabled={saveEntry.isPending} onClick={close}>Cancelar</button>{!entry && <button type="submit" value="another" className="btn" disabled={saveEntry.isPending}><Plus size={16}/>Salvar e adicionar outra</button>}<button type="submit" value="close" className="btn company-primary" disabled={saveEntry.isPending}>{saveEntry.isPending ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} {saveEntry.isPending ? 'Salvando…' : 'Salvar viagem'}</button></div>
    </form>
  </DialogContent></Dialog>;
}
