export const formatApplicationId = (id: string): string => {
  const compact = id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `OW-APP-${compact}`;
};
