'use client';

import {useEffect, useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {getSupabaseBrowserClient} from '@/shared/supabase/client';
import {
  authorizationIdFromSearch,
  consentLoginPath,
  decideOAuthConsent,
  loadOAuthConsent,
  type ConsentLoad,
} from '@/shared/supabase/oauthConsent';

export default function OAuthConsentPage() {
  const {user} = useAuth();
  const userId = user?.id;
  const [request, setRequest] = useState<ConsentLoad | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = authorizationIdFromSearch(window.location.search);
    if (!id) {
      queueMicrotask(() => setError('Esta solicitação de autorização é inválida.'));
      return;
    }
    if (!userId) {
      window.location.replace(consentLoginPath(id));
      return;
    }
    let active = true;
    void loadOAuthConsent(getSupabaseBrowserClient().auth, id, userId)
      .then(result => {if (active) setRequest(result);})
      .catch(() => {if (active) setError('Não foi possível validar esta solicitação. Reinicie a conexão do aplicativo.');});
    return () => {active = false;};
  }, [userId]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!userId || request?.kind !== 'consent' || busy) return;
    setBusy(true);
    setError('');
    try {
      const url = await decideOAuthConsent(
        getSupabaseBrowserClient().auth, request.details, userId, decision,
      );
      window.location.assign(url);
    } catch {
      setError('Não foi possível registrar sua decisão. Confira sua sessão e tente novamente.');
      setBusy(false);
    }
  };

  const details = request?.kind === 'consent' ? request.details : null;
  const scopes = details?.scope.trim().split(/\s+/).filter(Boolean) ?? [];

  return <main className="auth-screen auth-confirm-screen"><section className="auth-confirm-card">
    <span className="auth-confirm-icon"><ShieldCheck aria-hidden="true"/></span>
    <p className="auth-kicker">Controle de Faturamento</p>
    <h1>Autorizar aplicativo</h1>
    {error ? <p role="alert">{error}</p> : !request ?
      <p role="status">Verificando a solicitação…</p> : request.kind === 'redirect' ? <>
        <p>Este acesso já foi autorizado. Continue para o aplicativo.</p>
        <Button type="button" onClick={() => window.location.assign(request.url)}>Continuar</Button>
      </> : <>
        <p>Confira quem solicita acesso antes de decidir. O uso dos dados continua sujeito às permissões da sua conta.</p>
        <dl className="rounded-lg border border-slate-200 p-4 text-left text-sm break-words">
          <dt className="font-semibold">Aplicativo</dt><dd className="mb-3">{details!.client.name}</dd>
          <dt className="font-semibold">Conta</dt><dd className="mb-3">{details!.user.email}</dd>
          <dt className="font-semibold">Endereço de retorno</dt><dd className="mb-3">{details!.redirect_uri}</dd>
          <dt className="font-semibold">Permissões de identidade solicitadas</dt>
          <dd>{scopes.length ? <ul className="list-disc pl-5">{scopes.map(scope => <li key={scope}>{scope}</li>)}</ul> : 'Nenhuma informada'}</dd>
        </dl>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void decide('deny')}>Não permitir</Button>
          <Button type="button" disabled={busy} onClick={() => void decide('approve')}>{busy ? 'Aguarde…' : 'Permitir acesso'}</Button>
        </div>
      </>}
  </section></main>;
}
