import {Loader2, RefreshCw} from 'lucide-react';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
export function BillingQueryState({loading, errorMessage, noCompany, reload}: {
  loading: boolean; errorMessage: string; noCompany: boolean; reload: () => Promise<unknown>;
}) {
  if (loading) return <div className="company-empty" role="status"><Loader2 className="animate-spin"/><p>Carregando dados…</p></div>;
  if (errorMessage) return <div className="company-empty" role="alert"><h3>Não foi possível carregar os dados</h3><p>{errorMessage}</p><button className="btn" onClick={() => void reload()}><RefreshCw size={16}/>Tentar novamente</button></div>;
  if (noCompany) return <div className="company-empty"><h3>Cadastre sua empresa para começar</h3><p>A Agenda, o Resumo e os relatórios de contratos acompanham a empresa selecionada.</p><ModuleLink className="btn company-primary" href="/configuracoes?secao=empresas">Cadastrar empresa</ModuleLink></div>;
  return null;
}
