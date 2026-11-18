const materialNameOrder = new Intl.Collator('pt-BR', {sensitivity: 'base', numeric: true});

/** Presentation order only: preserve item identities, prices and the source array. */
export function sortQuotationItems<T extends {materialName: string}>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => materialNameOrder.compare(left.materialName, right.materialName));
}
