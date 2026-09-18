/* eslint-disable @next/next/no-img-element -- Private signed images must bypass the public image optimizer. */
import {PenLine, Loader2, RefreshCw} from 'lucide-react';
import {useSignatureImage} from '../hooks/useSignatures';

export function SignaturePreview({path, name, large = false}: {path?: string | null; name: string; large?: boolean}) {
  const image = useSignatureImage(path);
  return <div className={`signature-preview${large ? ' signature-preview-large' : ''}`}>
    {image.isFetching && !image.data ? <Loader2 size={18} className="animate-spin" aria-label="Carregando assinatura"/>
      : image.error ? <button type="button" className="signature-image-retry" onClick={() => void image.refetch()} title={image.error.message} aria-label={`Recarregar assinatura de ${name}`}><RefreshCw size={16}/><span>Recarregar</span></button>
        : image.data ? <img src={image.data} alt={`Assinatura de ${name}`} loading="lazy"/>
          : <span className="signature-manual-placeholder"><PenLine size={20}/><span>Assinatura manual</span></span>}
  </div>;
}
