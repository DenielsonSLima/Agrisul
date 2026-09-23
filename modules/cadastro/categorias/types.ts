export type MaterialCategory = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type MaterialCategoryInput = {
  id?: string;
  name: string;
};

export type MaterialCategoryCollection = {
  categories: MaterialCategory[];
};
