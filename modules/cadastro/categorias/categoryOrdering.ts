const categoryNameCollator = new Intl.Collator('pt-BR', {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
});

export function compareCategoryNames(left: string, right: string) {
  return categoryNameCollator.compare(left, right);
}

export function sortCategoriesAlphabetically<T extends {name: string}>(
  categories: readonly T[],
) {
  return [...categories].sort((left, right) =>
    compareCategoryNames(left.name, right.name),
  );
}
