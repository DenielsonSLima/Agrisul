'use client';

import {useMemo} from 'react';
import {PdfExportDialog} from '@/shared/reporting/PdfExportDialog';
import {useWorkspaceCompany} from '@/shared/state/WorkspaceCompanyProvider';
import {createPurchaseOrderPdf,createPurchaseOrderSnapshot} from '../reporting/purchaseOrderPdf';
import type {PurchaseOrder} from '../types';

export function PurchaseOrderExportDialog({order,onClose}:{order:PurchaseOrder;onClose:()=>void}){
  const {activeCompanyId}=useWorkspaceCompany();
  const snapshot=useMemo(()=>createPurchaseOrderSnapshot(order),[order]);
  return <PdfExportDialog snapshot={snapshot} companyId={activeCompanyId} createPdf={createPurchaseOrderPdf} orientation="portrait" title="Exportar pedido de compra" description={`${order.number} · ${order.providerLegalName} · confira a prévia completa antes de baixar.`} onClose={onClose}/>;
}
