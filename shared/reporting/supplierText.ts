// Import provenance and fleet identifiers belong to the internal register.
// Keep technical descriptions and commercial instructions in supplier PDFs.
export function supplierNotes(value: string) {
  const text = value.trim();
  return /^(?:Solicitação de compra n[º°]\s*\d+\s*;\s*referência conforme documento:|Itens transcritos da solicitação de compra n[º°]\s*\d+)/i.test(text)
    ? '' : text;
}

export function supplierApplication(value: string) {
  const text = value.trim();
  return /\bTRATOR(?:ES)?\b[\s\S]*(?:\bN[º°]\s*\d|\bNJ\s*\d)/i.test(text)
    ? '' : text;
}

export function supplierQuotationTitle(value: string) {
  return value
    .replace(/^Solicitação de compra n[º°]\s*\d+\s*-\s*/i, 'Cotação de peças - ')
    .replace(/\s+NJ\s*\d+(?:\s*\/\s*\d+)*/gi, '')
    .trim();
}

export function supplierQuotationFileName(providerName: string, number: string) {
  const filePart = (value: string, fallback: string, limit: number) => value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
    .replace(/[. ]+$/, '') || fallback;

  return `${filePart(providerName, 'Fornecedor', 160)} - ${filePart(number, 'Cotação', 60)}.pdf`;
}
