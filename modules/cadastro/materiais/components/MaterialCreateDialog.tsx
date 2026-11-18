'use client';

import {useState} from 'react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {notifications} from '@/shared/feedback';
import {useMaterialCategories} from '@/modules/cadastro/categorias/hooks/useMaterialCategories';
import {useMaterialMutations} from '@/modules/cotacao/hooks/useQuotes';
import type {Material} from '@/modules/cotacao/types';
import {MaterialForm} from './MaterialForm';

export function MaterialCreateDialog({initialName, onCreated, onClose, returnFocus}: {
  initialName: string;
  onCreated: (material: Material) => void;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const categories = useMaterialCategories();
  const mutations = useMaterialMutations();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={open => {if (!open && !busy) onClose();}}>
      <DialogContent
        className="form-modal material-modal"
        showCloseButton={!busy}
        onEscapeKeyDown={event => {if (busy) event.preventDefault();}}
        onPointerDownOutside={event => {if (busy) event.preventDefault();}}
        onCloseAutoFocus={event => {
          if (returnFocus?.isConnected) {
            event.preventDefault();
            returnFocus.focus({preventScroll: true});
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Cadastrar produto</DialogTitle>
          <DialogDescription>
            Cadastre o material para usá-lo nesta cotação. Os dados da cotação serão preservados.
          </DialogDescription>
        </DialogHeader>
        <MaterialForm
          initialName={initialName}
          categories={categories.categories}
          categoriesLoading={categories.loading}
          categoriesError={categories.error}
          saving={busy}
          onBusy={setBusy}
          onClose={onClose}
          onSave={async (input, image) => {
            const saved = await mutations.save(input, image);
            onCreated(saved);
            notifications.created('Produto cadastrado e selecionado na cotação.');
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
