import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

export type PlaybookSeedStep = {
  order: number;
  action: string;
  targetServiceKey?: string;
  approvalRequired: boolean;
  description: string;
};

export type PlaybookSeed = {
  key: string;
  name: string;
  description: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  steps: PlaybookSeedStep[];
};

export const AUTOMATION_PLAYBOOKS: PlaybookSeed[] = [
  {
    key: "REDIS_CASCADE_RECOVERY",
    name: "Redis cascade recovery",
    description: "Recover upstream Redis failure and verify dependent quote workflow services.",
    riskLevel: "LOW",
    steps: [
      {
        order: 1,
        action: "RERUN_CHECK",
        targetServiceKey: "redis",
        approvalRequired: false,
        description: "Confirm Redis is still failing."
      },
      {
        order: 2,
        action: "VERIFY_SERVICE",
        targetServiceKey: "pricing-engine",
        approvalRequired: false,
        description: "Verify Pricing Engine after Redis recovery."
      },
      {
        order: 3,
        action: "VERIFY_SERVICE",
        targetServiceKey: "quote-api",
        approvalRequired: false,
        description: "Verify Quote API after dependency recovery."
      },
      {
        order: 4,
        action: "REQUEUE_FAILED_JOB",
        approvalRequired: false,
        description: "Requeue eligible failed jobs once dependencies are healthy."
      },
      {
        order: 5,
        action: "VERIFY_SERVICE",
        targetServiceKey: "customer-quote-journey",
        approvalRequired: false,
        description: "Verify Customer Quote Journey workflow health."
      },
      {
        order: 6,
        action: "REQUEST_HUMAN_REVIEW",
        approvalRequired: false,
        description: "Escalate if any verification step still fails."
      }
    ]
  },
  {
    key: "WEBHOOK_DELIVERY_RECOVERY",
    name: "Webhook delivery recovery",
    description: "Replay failed webhook deliveries and confirm provider health.",
    riskLevel: "LOW",
    steps: [
      { order: 1, action: "CHECK_PROVIDER_STATUS", approvalRequired: false, description: "Check provider status." },
      { order: 2, action: "RETRY_WEBHOOKS", approvalRequired: false, description: "Retry failed webhook deliveries." },
      { order: 3, action: "ADD_INCIDENT_NOTE", approvalRequired: false, description: "Record webhook recovery attempt." }
    ]
  },
  {
    key: "HTTP_CHECK_INVESTIGATION",
    name: "HTTP check investigation",
    description: "Investigate HTTP status mismatch without changing monitoring policy automatically.",
    riskLevel: "MEDIUM",
    steps: [
      { order: 1, action: "RERUN_CHECK", approvalRequired: false, description: "Run confirmation HTTP check." },
      { order: 2, action: "ADD_INCIDENT_NOTE", approvalRequired: false, description: "Summarise recent check history." },
      {
        order: 3,
        action: "REVIEW_HTTP_EXPECTED_STATUS",
        approvalRequired: true,
        description: "Recommend expected-status review; requires operator approval."
      }
    ]
  }
];

export const seedAutomationPlaybooks = async (prisma: PrismaClient): Promise<void> => {
  const now = new Date();
  for (const playbook of AUTOMATION_PLAYBOOKS) {
    const playbookId = `apb-${playbook.key.toLowerCase()}`;
    await prisma.automationPlaybook.upsert({
      where: { key: playbook.key },
      update: {
        name: playbook.name,
        description: playbook.description,
        riskLevel: playbook.riskLevel,
        isActive: true,
        updatedAt: now
      },
      create: {
        id: playbookId,
        key: playbook.key,
        name: playbook.name,
        description: playbook.description,
        riskLevel: playbook.riskLevel,
        isActive: true,
        updatedAt: now
      }
    });

    const existingVersion = await prisma.automationPlaybookVersion.findFirst({
      where: { playbookId, version: 1 }
    });
    const versionId = existingVersion?.id ?? `apv-${playbook.key.toLowerCase()}-v1`;

    await prisma.automationPlaybookVersion.upsert({
      where: { playbookId_version: { playbookId, version: 1 } },
      update: {
        definitionJson: { steps: playbook.steps },
        status: "APPROVED",
        approvedAt: now,
        publishedAt: now,
        publishedBy: "system-seed"
      },
      create: {
        id: versionId,
        playbookId,
        version: 1,
        status: "APPROVED",
        approvedAt: now,
        definitionJson: { steps: playbook.steps },
        publishedAt: now,
        publishedBy: "system-seed"
      }
    });

    for (const step of playbook.steps) {
      const stepId = `aps-${playbook.key.toLowerCase()}-${step.order}`;
      await prisma.automationPlaybookStep.upsert({
        where: { versionId_stepOrder: { versionId, stepOrder: step.order } },
        update: {
          action: step.action,
          targetServiceKey: step.targetServiceKey ?? null,
          approvalRequired: step.approvalRequired,
          description: step.description
        },
        create: {
          id: stepId,
          versionId,
          stepOrder: step.order,
          action: step.action,
          targetServiceKey: step.targetServiceKey ?? null,
          approvalRequired: step.approvalRequired,
          description: step.description
        }
      });
    }
  }
};
