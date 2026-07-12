export const createExclusiveRunner = (jobName: string) => {
  let running = false;

  return async (job: () => Promise<void>): Promise<"ran" | "skipped"> => {
    if (running) {
      console.warn(`[opswatch-worker] Skipping overlapping ${jobName} run`);
      return "skipped";
    }

    running = true;
    try {
      await job();
      return "ran";
    } finally {
      running = false;
    }
  };
};
