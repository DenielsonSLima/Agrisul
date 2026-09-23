export type PaymentMethod = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentMethodInput = {
  id?: string;
  name: string;
  description: string;
};

export type PaymentMethodCollection = {
  paymentMethods: PaymentMethod[];
};
