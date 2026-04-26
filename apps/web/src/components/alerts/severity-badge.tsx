export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`severity ${severity.toLowerCase()}`}>{severity}</span>;
}
