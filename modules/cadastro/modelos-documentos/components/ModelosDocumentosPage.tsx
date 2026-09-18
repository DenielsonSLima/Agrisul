'use client';
import {useState} from 'react';
import {ArrowLeft, ArrowUpRight, ChevronRight, FileText, LayoutTemplate, Loader2, RefreshCw, Wrench} from 'lucide-react';
import {ModuleLink, useModuleNavigation} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useDocumentTemplate, useDocumentTemplates} from '../hooks/useDocumentTemplates';
import {DocumentTemplateEditor} from './DocumentTemplateEditor';
import '../styles.css';

const modelsHref = '/cadastro?secao=modelos-documentos';

export function ModelosDocumentosPage() {
  const {user} = useAuth();
  return <DocumentModelsWorkspace key={user?.id ?? 'anonymous'}/>;
}

function DocumentModelsWorkspace() {
  const {searchParams} = useModuleNavigation();
  return searchParams.get('modelo') === 'service-request' ? <TemplateLoader/> : <TemplateCatalog/>;
}

function TemplateCatalog() {
  const model = useDocumentTemplates();
  return <section className="document-models-catalog">
    <div className="client-navigation"><nav className="client-breadcrumb" aria-label="Caminho de navegação"><ModuleLink href="/cadastro">Cadastros</ModuleLink><ChevronRight size={13}/><span aria-current="page">Modelos de documentos</span></nav><ModuleLink className="client-back" href="/cadastro"><ArrowLeft size={15}/>Voltar aos cadastros</ModuleLink></div>
    <div className="companies-heading"><div><h2>Modelos de documentos</h2><p>Organize os textos, campos e assinaturas dos documentos de cada módulo.</p></div></div>
    {model.loading ? <div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Carregando modelos…</div> : model.error ? <LoadError error={model.error} reload={model.reload}/> : <div className="document-models-grid">
      <article className="document-module-card"><header><span><Wrench size={22}/></span><div><h3>Solicitações</h3><p>Formulários para pedidos e aprovação de serviços.</p></div></header><div className="document-template-cards">{model.data?.items.map(template => <ModuleLink key={template.key} href={`${modelsHref}&modelo=${template.key}`} className="document-template-card"><div className="document-template-miniature" aria-hidden="true"><div><span/><strong/><i/><i/><i/><section><b/><b/></section><em/></div></div><div><span>DOCUMENTO A4</span><h4>{template.name}</h4><p>{template.version ? `Versão ${template.version}` : 'Modelo inicial'} · {model.data?.canManage ? 'Editor visual' : 'Consulta'}</p><span className="document-template-open">{model.data?.canManage ? 'Editar modelo' : 'Visualizar modelo'}<ArrowUpRight size={15}/></span></div></ModuleLink>)}</div>{!model.data?.items.length && <p className="document-template-empty"><FileText size={17}/>Nenhum modelo disponível para este módulo.</p>}</article>
    </div>}
    <div className="document-models-note"><LayoutTemplate size={19}/><p>Os modelos salvos são usados nas novas solicitações. Cada documento mantém a versão usada no seu registro.</p></div>
  </section>;
}

function TemplateLoader() {
  const model = useDocumentTemplate('service-request');
  const {navigate} = useModuleNavigation();
  const [revision, setRevision] = useState(0);
  if (model.loading) return <div className="client-loading" role="status"><Loader2 size={20} className="animate-spin"/>Abrindo editor…</div>;
  if (model.error || !model.data) return <><ModuleLink href={modelsHref} className="client-back"><ArrowLeft size={15}/>Voltar aos modelos</ModuleLink><LoadError error={model.error || 'Modelo indisponível.'} reload={model.reload}/></>;
  return <DocumentTemplateEditor key={revision} template={model.data.template} canManage={model.data.canManage} saving={model.saving} onSave={model.save} onBack={() => navigate(modelsHref)} onReload={async () => {await model.reload(); setRevision(value => value + 1);}}/>;
}

function LoadError({error, reload}: {error: string; reload: () => Promise<void>}) {
  return <div className="company-empty" role="alert"><h3>Não foi possível carregar os modelos</h3><p>{error}</p><button type="button" className="btn" onClick={() => void reload()}><RefreshCw size={16}/>Tentar novamente</button></div>;
}
