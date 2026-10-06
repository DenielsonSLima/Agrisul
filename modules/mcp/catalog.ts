export type CatalogReference = {id: string; brand: string; code: string};
export type CatalogMaterial = {
  id: string;
  name: string;
  internalCode: string;
  unit: string;
  imageKey: string | null;
  references: CatalogReference[];
};

export type ExtractedItem = {
  materialId?: string;
  name: string;
  internalCode?: string;
  unit: string;
  quantity: string;
  brand?: string;
  code?: string;
  sourceText: string;
  imageSourceUrl?: string;
  imageEvidenceUrl?: string;
};

export type ImportMatch = {
  line: number;
  status: 'existing' | 'new' | 'ambiguous' | 'needs-identification' | 'needs-photo';
  materialId?: string;
  candidateIds?: string[];
  reason?: string;
};

const fold = (value: string | undefined) => (value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/** This preview never decides that a similar name or photo identifies a product. */
export function matchImportItems(items: ExtractedItem[], materials: CatalogMaterial[]): ImportMatch[] {
  return items.map((item, index) => {
    const line = index + 1;
    if (!fold(item.sourceText) || !fold(item.name) || !fold(item.unit) || !fold(item.quantity)) {
      return {line, status: 'needs-identification', reason: 'A linha, o nome, a unidade e a quantidade precisam estar legíveis.'};
    }

    const explicit = item.materialId ? materials.filter(material => material.id === item.materialId) : [];
    if (item.materialId && explicit.length !== 1) {
      return {line, status: 'ambiguous', reason: 'O material escolhido não está no catálogo acessível.'};
    }
    const internal = fold(item.internalCode);
    const brand = fold(item.brand);
    const code = fold(item.code);
    const byInternal = internal
      ? materials.filter(material => fold(material.internalCode) === internal)
      : [];
    const byReference = brand && code
      ? materials.filter(material => material.references.some(reference =>
        fold(reference.brand) === brand && fold(reference.code) === code))
      : [];
    if (explicit.length === 1) {
      const chosen = explicit[0];
      if (fold(chosen.unit) !== fold(item.unit)) {
        return {line, status: 'ambiguous', candidateIds: [chosen.id], reason: 'A unidade da linha difere da unidade do material escolhido.'};
      }
      const codeProvesIdentity = byInternal.some(material => material.id === chosen.id)
        || byReference.some(material => material.id === chosen.id);
      if (!codeProvesIdentity && fold(chosen.name) !== fold(item.name)) {
        return {line, status: 'ambiguous', candidateIds: [chosen.id], reason: 'O nome da linha difere do material escolhido e nenhum código existente confirma a identidade.'};
      }
    }
    const strongIds = new Set([...explicit, ...byInternal, ...byReference].map(material => material.id));
    if (strongIds.size > 1) {
      return {line, status: 'ambiguous', candidateIds: [...strongIds], reason: 'Os códigos apontam para materiais diferentes.'};
    }
    if (strongIds.size === 1) {
      const match = materials.find(material => material.id === [...strongIds][0]);
      if (match && fold(match.unit) !== fold(item.unit)) {
        return {line, status: 'ambiguous', candidateIds: [match.id], reason: 'A unidade da linha difere da unidade do material existente.'};
      }
      return {line, status: 'existing', materialId: [...strongIds][0]};
    }

    const sameNameAndUnit = materials.filter(material =>
      fold(material.name) === fold(item.name) && fold(material.unit) === fold(item.unit));
    if (sameNameAndUnit.length) {
      return {
        line,
        status: 'ambiguous',
        candidateIds: sameNameAndUnit.map(material => material.id),
        reason: 'Já existe um material com o mesmo nome e unidade; escolha o registro correto.',
      };
    }
    if (!brand || !code) {
      return {line, status: 'needs-identification', reason: 'Para um material novo, informe marca e código legíveis.'};
    }
    if (!item.imageSourceUrl || !item.imageEvidenceUrl) {
      return {line, status: 'needs-photo', reason: 'Encontre foto exata com página que comprove marca e código.'};
    }
    return {line, status: 'new'};
  });
}

export function searchCatalog(materials: CatalogMaterial[], query: string, limit = 20): CatalogMaterial[] {
  const needle = fold(query);
  if (!needle) return [];
  return materials.filter(material => [
    material.name,
    material.internalCode,
    ...material.references.flatMap(reference => [reference.brand, reference.code, `${reference.brand} ${reference.code}`]),
  ].some(value => fold(value).includes(needle))).slice(0, limit);
}
