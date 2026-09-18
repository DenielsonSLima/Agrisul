/* eslint-disable @next/next/no-img-element -- Local PNG previews and private signed originals must bypass image optimization. */
import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {Loader2, PenLine, Save, Trash2, Upload, X} from 'lucide-react';
import {Field} from '@/shared/components/Common';
import {notifications, useConfirmation} from '@/shared/feedback';
import {validateSignatureFile} from '../services/signatureApi';
import {SignaturePreview} from '../components/SignaturePreview';
import {signatureRoleLabels, type Signature, type SignatureInput, type SignatureOptions, type SignatureRole} from '../types';

type Props = {
  signature?: Signature;
  users: SignatureOptions['users'];
  onSave: (input: SignatureInput) => Promise<unknown>;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
};

export type SignatureFormHandle = {requestClose: () => Promise<void>};
export const SignatureForm = forwardRef<SignatureFormHandle, Props>(function SignatureForm({signature, users, onSave, onClose, onBusy}, ref) {
  const confirm = useConfirmation();
  const [name, setName] = useState(signature?.name ?? '');
  const [userId, setUserId] = useState(signature?.userId ?? '');
  const [role, setRole] = useState<SignatureRole>(signature?.role ?? 'requester');
  const [file, setFile] = useState<File>();
  const [removeImage, setRemoveImage] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const closing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  useEffect(() => () => {if (preview) URL.revokeObjectURL(preview);}, [preview]);
  async function close() {
    if (submitting.current || closing.current) return;
    closing.current = true;
    const dirty = name !== (signature?.name ?? '') || userId !== (signature?.userId ?? '') || role !== (signature?.role ?? 'requester') || !!file || removeImage;
    try {if ((!dirty || await confirm({title: 'Descartar alterações do cadastro?', description: 'O nome, a função e a imagem editados neste formulário ainda não foram salvos.', confirmLabel: 'Descartar alterações', tone: 'destructive'})) && mounted.current) onClose();}
    finally {closing.current = false;}
  }
  useImperativeHandle(ref, () => ({requestClose: close}));
  function clearFile() {setFile(undefined); setPreview(''); setFileError(''); if (fileInput.current) fileInput.current.value = '';}
  async function removeExistingImage() {
    const accepted = await confirm({title: 'Remover a imagem do cadastro?', description: 'Os novos documentos poderão ser assinados manualmente. As solicitações anteriores manterão a imagem registrada na ocasião.', confirmLabel: 'Remover imagem', tone: 'destructive'});
    if (!accepted || !mounted.current) return;
    clearFile(); setRemoveImage(true);
  }

  return <form onSubmit={async event => {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    submitting.current = true;
    setSaving(true); onBusy(true);
    try {
      await onSave({...(signature ? {id: signature.id} : {}), name, userId: role === 'manager' ? userId : null, role, file, ...(removeImage ? {removeImage: true} : {})});
      if (mounted.current) {
        if (signature) notifications.updated(signature.active ? 'A assinatura foi atualizada.' : 'A assinatura foi reativada.');
        else notifications.created('A assinatura foi cadastrada.');
        onClose();
      }
    } catch (caught) {
      if (mounted.current) {
        const message = (caught as Error).message;
        setError(message); notifications.error(message);
      }
    } finally {
      submitting.current = false;
      if (mounted.current) {setSaving(false); onBusy(false);}
    }
  }}>
    <fieldset className="company-fieldset signature-form-fields" disabled={saving}>
      <div className={`signature-form-grid${role === 'requester' ? ' signature-form-requester' : ''}`}>
        <Field label="Função na solicitação">
          <select className="signature-select" value={role} onChange={event => setRole(event.target.value as SignatureRole)}>
            {Object.entries(signatureRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        {role === 'manager' && <Field label="Usuário do diretor geral">
          <select className="signature-select" value={userId} onChange={event => {setUserId(event.target.value); if (!name) setName(users.find(user => user.id === event.target.value)?.name ?? '');}} required>
            <option value="" disabled>Selecione o usuário</option>
            {signature?.userId && !users.some(user => user.id === signature.userId) && <option value={signature.userId} disabled>{signature.name} — usuário indisponível</option>}
            {users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </Field>}
      </div>
      <Field label="Nome para assinatura"><input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={150} autoFocus placeholder="Nome completo do responsável"/></Field>
      <p className="field-help">{role === 'requester' ? 'O nome é suficiente para cadastrar o solicitante. A imagem PNG é opcional e a pessoa não precisa de conta no sistema.' : 'O diretor geral precisa de uma conta vinculada para registrar decisões. A imagem PNG é opcional; sem ela, o documento terá espaço para assinatura manual. A permissão de aprovação é definida no perfil de acesso.'}</p>
      {role === 'manager' && !users.length && <p className="form-error" role="alert">Nenhum usuário ativo está disponível para vincular ao diretor geral.</p>}
      <div className="signature-upload">
        <label className="signature-upload-label">
          <span><Upload size={17}/>{signature?.filePath && !removeImage ? 'Substituir imagem PNG (opcional)' : 'Imagem da assinatura (opcional)'}</span>
          <input ref={fileInput} type="file" accept="image/png,.png" aria-describedby="signature-file-help" onChange={event => {
            const next = event.target.files?.[0];
            if (!next) return;
            setFileError('');
            try {validateSignatureFile(next); setFile(next); setRemoveImage(false); setPreview(URL.createObjectURL(next));} catch (caught) {setFileError((caught as Error).message); event.target.value = '';}
          }}/>
        </label>
        <p id="signature-file-help" className="field-help">Se desejar incluir a imagem nos documentos, envie um PNG de até 3 MB. Ela poderá ser dispensada ao escolher a assinatura manual.</p>
        {fileError && <p className="form-error" role="alert">{fileError}</p>}
        {preview ? <div className="signature-preview signature-preview-large"><img src={preview} alt="Prévia da nova assinatura" onError={() => setFileError('Não foi possível ler a imagem. Selecione um arquivo PNG válido.')}/></div>
          : signature?.filePath && !removeImage ? <SignaturePreview path={signature.filePath} name={signature.name} large/>
            : <div className="signature-upload-placeholder"><PenLine size={26}/><span>Assinatura manual disponível</span><small>O nome será impresso com espaço para assinar.</small></div>}
        {file && <p className="signature-file-name">{file.name}</p>}
        <div className="signature-file-actions">{(file || fileError) && <button type="button" className="btn" onClick={clearFile}><X size={15}/>Limpar seleção</button>}{signature?.filePath && !removeImage && <button type="button" className="btn" onClick={() => void removeExistingImage()}><Trash2 size={15}/>Remover PNG do cadastro</button>}{removeImage && <><span>A imagem será removida ao salvar.</span><button type="button" className="btn" onClick={() => setRemoveImage(false)}>Manter PNG atual</button></>}</div>
      </div>
      {signature && <p className="field-help">As solicitações já registradas mantêm a assinatura usada na ocasião.</p>}
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions">
      <button className="btn" type="button" onClick={() => void close()} disabled={saving}>Cancelar</button>
      <button className="btn company-primary" type="submit" disabled={saving || !!fileError || (role === 'manager' && !users.length)}>
        {saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}
        {saving ? 'Salvando…' : signature ? signature.active ? 'Salvar alterações' : 'Salvar e reativar' : 'Cadastrar assinatura'}
      </button>
    </div>
  </form>;
});
