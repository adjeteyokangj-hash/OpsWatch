export const isRecentTimestamp = (isoTimestamp: string, maxAgeMinutes = 5): boolean => {
  const ts = new Date(isoTimestamp).getTime();
  if (Number.isNaN(ts)) {
    return false;
  }
  const ageMs = Math.abs(Date.now() - ts);
  return ageMs <= maxAgeMinutes * 60 * 1000;
};
