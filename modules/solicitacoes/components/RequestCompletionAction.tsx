'use client';
import {useEffect, useRef, useState} from 'react';
import {CheckCircle2, Loader2} from 'lucide-react';
import {notifications, useConfirmation} from '@/shared/feedback';
import {useRequestCompletionMutation} from '../hooks/useServiceRequests';
import {assertRequestActor} from '../services/requestApi';
import type {ServiceRequest} from '../types';

export function RequestCompletionAction({request, actorId}: {request: ServiceRequest; actorId: string}) {
  const mutation = useRequestCompletionMutation(), confirm = useConfirmation();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  if (!request.canComplete) return null;
  return <div className="request-completion-action"><button className="btn request-export-button" type="button" disabled={busy} onClick={async () => {
    if (operation.current) return;
    const controller = new AbortController();operation.current = controller;setBusy(true);setError('');
    const execution = {actorId, signal: controller.signal};
    try {
      if (!await confirm({title: `Finalizar serviço da solicitação nº ${request.number}?`, description: 'Confirme que o serviço foi concluído. O registro ficará como Finalizado, com seu usuário, data e hora no histórico.', confirmLabel: 'Finalizar serviço'})) return;
      await assertRequestActor(execution);
      await mutation.mutateAsync({id: request.id, execution});
      await assertRequestActor(execution);
      notifications.updated('O serviço foi finalizado e a conclusão ficou registrada no histórico.');
    } catch (caught) {
      if (!controller.signal.aborted) {const message = caught instanceof Error ? caught.message : 'Não foi possível finalizar o serviço.';setError(message);notifications.error(message);}
    } finally {if (!controller.signal.aborted) setBusy(false);if (operation.current === controller) operation.current = null;}
  }}>{busy ? <Loader2 size={16} className="animate-spin"/> : <CheckCircle2 size={16}/>}Finalizar serviço</button>{error && <p className="request-inline-error" role="alert">{error}</p>}</div>;
}
