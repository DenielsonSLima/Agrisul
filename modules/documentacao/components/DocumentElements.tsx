'use client';
/* eslint-disable @next/next/no-img-element -- Private image previews use temporary signed URLs. */
import {useEffect, useRef, useState} from 'react';
import {AlertCircle, Download, Eye, FileText, FolderOpen, Loader2, Paperclip} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {ModuleLink} from '@/shared/navigation/ModuleNavigation';
import {useAuth} from '@/shared/supabase/AuthProvider';
import {useCadastroQuery} from '@/modules/cadastro/hooks/useCadastroQuery';
import {dateLabel, moneyLabel} from '@/shared/utils/presentation';
import {documentationFileUrl} from '../services/documentationApi';
import {documentKinds, documentStatuses, type BillingDocument, type DocumentExecution, type DocumentFile} from '../types';

export const documentationHref = (id: string) => `/documentacao?documento=${encodeURIComponent(id)}`;
export function useDocumentOperation() {
  const {user} = useAuth();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const active = new AbortController();controller.current = active;
    return () => active.abort();
  }, [user?.id]);
  return (): DocumentExecution => {
    if (!controller.current) throw new DOMException('Formulário indisponível', 'AbortError');
    return {actorId: user?.id ?? '', signal: controller.current.signal};
  };
}
export function DocumentState({loading, error, retry}: {loading?: boolean; error?: string; retry?: () => void}) {
  if (loading) return <div className="documentation-state" role="status"><Loader2 className="animate-spin" size={22}/>Carregando documentação…</div>;
  if (error) return <div className="documentation-state" role="alert"><AlertCircle size={22}/><strong>{error}</strong>{retry && <button type="button" className="btn" onClick={retry}>Tentar novamente</button>}</div>;
  return null;
}
export function DocumentTable({documents}: {documents: BillingDocument[]}) {
  if (!documents.length) return <div className="documentation-empty"><FolderOpen size={32}/><h3>Nenhum documento encontrado</h3><p>Adicione notas, boletos, comprovantes ou imagens e mantenha os arquivos juntos das suas referências.</p></div>;
  return <div className="documentation-table-wrap"><table className="documentation-table"><thead><tr><th>Documento</th><th>Fornecedor / referência</th><th>Emissão / valor</th><th>Situação</th><th><span className="sr-only">Abrir</span></th></tr></thead><tbody>{documents.map(document => <tr key={document.id}>
    <td><ModuleLink className="documentation-title-link" href={documentationHref(document.id)}>{document.title}</ModuleLink><small>{documentKinds[document.kind]}{document.documentNumber ? ` · Nº ${document.documentNumber}` : ''} · {document.files.length} arquivo(s)</small></td>
    <td><span>{document.providerName || 'Fornecedor não informado'}</span><small>{document.sources.map(source => source.label).join(' · ') || 'Aguardando identificação'}</small></td>
    <td><span>{document.issuedOn ? dateLabel(document.issuedOn) : 'Emissão não informada'}</span><small>{document.amount === null ? 'Valor não informado' : moneyLabel(document.amount)}</small></td>
    <td><span className={`documentation-badge is-${document.status}`}>{documentStatuses[document.status]}</span></td>
    <td><ModuleLink className="btn" href={documentationHref(document.id)} aria-label={`Abrir ${document.title}`}><Eye size={15}/><span>Abrir</span></ModuleLink></td>
  </tr>)}</tbody></table></div>;
}
function FileContent({file}: {file: DocumentFile}) {
  const [failed, setFailed] = useState(false);
  const preview = useCadastroQuery('documentation', {view: 'file', bucket: file.bucket, path: file.path}, signal => documentationFileUrl(file, signal));
  const download = useCadastroQuery('documentation', {view: 'download', bucket: file.bucket, path: file.path}, signal => documentationFileUrl(file, signal, true));
  return <>
    <div className="documentation-file-tools"><span>{file.contentType} · {new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 1}).format(file.size / 1024)} KB</span>{download.data && <a href={download.data} className="btn" download={file.fileName} target="_blank" rel="noopener noreferrer"><Download size={15}/>Baixar arquivo</a>}</div>
    <DocumentState loading={preview.loading} error={preview.error} retry={() => void preview.reload()}/>
    {preview.data && <div className="documentation-preview">{failed ? <p role="alert">Não foi possível exibir este arquivo. Use a opção de download.</p> : file.contentType === 'application/pdf'
      ? <iframe src={preview.data} title={`Prévia de ${file.fileName}`} onError={() => setFailed(true)}/>
      : file.contentType.startsWith('image/') ? <img src={preview.data} alt={file.fileName} onError={() => setFailed(true)}/>
        : <div className="documentation-empty"><FileText size={32}/><p>Arquivo XML disponível para download.</p></div>}</div>}
  </>;
}
export function DocumentFiles({files, title = 'Arquivos'}: {files: DocumentFile[]; title?: string}) {
  const [selected, setSelected] = useState<DocumentFile | null>(null);
  return <section className="documentation-section"><h3><Paperclip size={18}/>{title} <span>{files.length}</span></h3>
    {files.length ? <ul className="documentation-files">{files.map(file => <li key={file.id}><FileText size={20}/><span>{file.fileName}</span><button className="btn" type="button" onClick={() => setSelected(file)}><Eye size={15}/>Visualizar</button></li>)}</ul> : <p>Nenhum arquivo anexado.</p>}
    {selected && <Dialog open onOpenChange={open => {if (!open) setSelected(null);}}><DialogContent className="documentation-preview-dialog"><DialogTitle>{selected.fileName}</DialogTitle><DialogDescription>Arquivo privado disponível para consulta e download.</DialogDescription><FileContent key={selected.id} file={selected}/></DialogContent></Dialog>}
  </section>;
}
