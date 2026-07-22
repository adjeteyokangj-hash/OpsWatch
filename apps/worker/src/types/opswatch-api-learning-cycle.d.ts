declare module "@opswatch/api/learning-cycle" {
  export const runLearningCycleForAllOrgs: () => Promise<{
    orgCount: number;
    succeededOrgCount: number;
    failedOrgCount: number;
    results: unknown[];
    failures: Array<{ organizationId: string; error: string }>;
  }>;
  export const runLearningCycleForOrg: (organizationId: string) => Promise<unknown>;
}
