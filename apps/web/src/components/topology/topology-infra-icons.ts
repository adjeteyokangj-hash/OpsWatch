export type InfraIcon = {
  label: string;
  glyph: string;
  color: string;
  background: string;
};

const matchers: Array<{ pattern: RegExp; icon: InfraIcon }> = [
  { pattern: /postgres|postgresql/i, icon: { label: "PostgreSQL", glyph: "PG", color: "#1d4ed8", background: "#dbeafe" } },
  { pattern: /redis/i, icon: { label: "Redis", glyph: "RD", color: "#b91c1c", background: "#fee2e2" } },
  { pattern: /rabbitmq|amqp/i, icon: { label: "RabbitMQ", glyph: "MQ", color: "#c2410c", background: "#ffedd5" } },
  { pattern: /kafka/i, icon: { label: "Kafka", glyph: "KF", color: "#0f172a", background: "#e2e8f0" } },
  { pattern: /kubernetes|k8s/i, icon: { label: "Kubernetes", glyph: "K8", color: "#2563eb", background: "#dbeafe" } },
  { pattern: /docker/i, icon: { label: "Docker", glyph: "DK", color: "#0369a1", background: "#e0f2fe" } },
  { pattern: /azure/i, icon: { label: "Azure", glyph: "Az", color: "#1d4ed8", background: "#dbeafe" } },
  { pattern: /aws|amazon/i, icon: { label: "AWS", glyph: "AW", color: "#b45309", background: "#fef3c7" } },
  { pattern: /cloudflare/i, icon: { label: "Cloudflare", glyph: "CF", color: "#c2410c", background: "#ffedd5" } },
  { pattern: /nginx/i, icon: { label: "Nginx", glyph: "NX", color: "#15803d", background: "#dcfce7" } },
  { pattern: /mysql|mariadb/i, icon: { label: "MySQL", glyph: "MY", color: "#1e40af", background: "#dbeafe" } },
  { pattern: /mongo/i, icon: { label: "MongoDB", glyph: "MG", color: "#166534", background: "#dcfce7" } },
  { pattern: /elastic/i, icon: { label: "Elastic", glyph: "ES", color: "#0f766e", background: "#ccfbf1" } },
  { pattern: /s3|bucket/i, icon: { label: "S3", glyph: "S3", color: "#b45309", background: "#fef3c7" } },
  { pattern: /paystack|stripe|paypal/i, icon: { label: "Payments", glyph: "$", color: "#7c3aed", background: "#ede9fe" } },
  { pattern: /sendgrid|mailgun|smtp|email/i, icon: { label: "Email", glyph: "@", color: "#0369a1", background: "#e0f2fe" } },
  { pattern: /twilio|sms/i, icon: { label: "SMS", glyph: "SM", color: "#be123c", background: "#ffe4e6" } }
];

export const resolveInfraIcon = (name: string): InfraIcon | null => {
  for (const entry of matchers) {
    if (entry.pattern.test(name)) return entry.icon;
  }
  return null;
};
