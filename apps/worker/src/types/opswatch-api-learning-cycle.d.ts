declare module "@opswatch/api/learning-cycle" {
  export const runLearningCycleForAllOrgs: () => Promise<{
    orgCount: number;
    results: unknown[];
  }>;
  export const runLearningCycleForOrg: (organizationId: string) => Promise<unknown>;
}
