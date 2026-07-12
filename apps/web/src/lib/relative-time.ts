export const formatRelativeTime = (value: string | Date | null | undefined): string => {
  if (!value) return "—";
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "—";

  const ageSec = Math.floor((Date.now() - timestamp) / 1000);
  if (ageSec < 15) return "Just now";
  if (ageSec < 60) return `${ageSec} sec ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin} min ago`;
  const ageHours = Math.floor(ageMin / 60);
  if (ageHours < 24) return `${ageHours} h ago`;
  return new Date(timestamp).toLocaleString();
};
