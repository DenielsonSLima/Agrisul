import {useEffect, useRef, useState} from 'react';
import {Loader2, Save} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {Choice, Field} from '@/shared/components/Common';
import {notifications} from '@/shared/feedback';
import {localDay} from '@/shared/utils/presentation';
import {useClients} from '@/modules/cadastro/clientes/hooks/useClients';
import {useWeighingMutations} from '../hooks/useWeighings';
import type {WeighingControl} from '../types';

export function WeighingControlDialog({control, onClose, onSaved}: {control?: WeighingControl; onClose: () => void; onSaved: (id: string) => void}) {
  const partners = useClients();
  const {save} = useWeighingMutations();
  const [startDate, setStartDate] = useState(control?.startDate ?? localDay());
  const [partnerId, setPartnerId] = useState(control?.partnerId ?? '');
  const [season, setSeason] = useState(control?.season ?? '');
  const [notes, setNotes] = useState(control?.notes ?? '');
  const [error, setError] = useState('');
  const mounted = useRef(true), inFlight = useRef(false);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const close = () => {if (!inFlight.current) onClose();};
  return <Dialog open onOpenChange={open => {if (!open) close();}}><DialogContent className="form-modal weighing-control-dialog" onEscapeKeyDown={event => {if (save.isPending) event.preventDefault();}} onPointerDownOutside={event => {if (save.isPending) event.preventDefault();}}>
    <DialogHeader><DialogTitle>{control ? 'Editar controle de pesagem' : 'Novo controle de pesagem'}</DialogTitle><DialogDescription>Selecione a data de início e o parceiro. Depois, adicione as viagens e confira os pesos.</DialogDescription></DialogHeader>
    <form onSubmit={async event => {
      event.preventDefault();
      if (inFlight.current) return;
      if (!startDate || !partnerId) {setError('Informe a data de início e selecione o parceiro.'); return;}
      setError(''); inFlight.current = true;
      try {
        const result = await save.mutateAsync({input: {startDate, partnerId, season, notes}, id: control?.id});
        if (mounted.current) {
          if (control) notifications.updated('O controle de pesagem foi atualizado.');
          else notifications.created('O controle está pronto para receber as viagens.');
          onSaved(result.id);
        }
      } catch (reason) {if (mounted.current) {const message = (reason as Error).message; setError(message); notifications.error(message);}}
      finally {inFlight.current = false;}
    }}>
      <fieldset className="company-fieldset" disabled={save.isPending}>
        <Field label="Data de início *"><input type="date" min="1900-01-01" max="9998-12-31" value={startDate} onChange={event => setStartDate(event.target.value)} required autoFocus/></Field>
        <Field label="Parceiro *"><Choice value={partnerId} onChange={setPartnerId} label="Selecione o parceiro" disabled={partners.loading || !!partners.error} items={partners.clients.map(partner => ({value: partner.id, label: partner.legalName}))}/></Field>
        {partners.loading && <p className="weighing-help" role="status">Carregando parceiros…</p>}
        {partners.error && <div className="form-error" role="alert">{partners.error}<button type="button" className="btn" onClick={() => void partners.reload()}>Tentar novamente</button></div>}
        {!partners.loading && !partners.error && !partners.clients.length && <p className="weighing-help">Cadastre o parceiro em Cadastros → Parceiros para criar o controle.</p>}
        <Field label="Safra (opcional)"><input maxLength={30} placeholder="Ex.: 2026/2027. Se vazio, usa a data de início." value={season} onChange={event => setSeason(event.target.value)}/></Field>
        <Field label="Observações"><textarea rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Anotações sobre este comparativo"/></Field>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="btn" disabled={save.isPending} onClick={close}>Cancelar</button><button type="submit" className="btn company-primary" disabled={save.isPending || partners.loading || !!partners.error || !partners.clients.length}>{save.isPending ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} {save.isPending ? 'Salvando…' : control ? 'Salvar alterações' : 'Criar controle'}</button></div>
    </form>
  </DialogContent></Dialog>;
}
