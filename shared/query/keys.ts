export const billingKeys = {
  all: (userId: string) => ['billing', userId] as const,
  resource: (userId: string, resource: string) => ['billing', userId, resource] as const,
};
