export const formatApplicationId = (id: string): string => {
  const compact = id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `OW-APP-${compact}`;
};

export const maskSecret = (value: string, visibleTail = 0): string => {
  if (!value) return "—";
  if (visibleTail > 0 && value.length > visibleTail) {
    return `${"*".repeat(Math.min(value.length - visibleTail, 24))}${value.slice(-visibleTail)}`;
  }
  return "*".repeat(Math.min(value.length, 24));
};
