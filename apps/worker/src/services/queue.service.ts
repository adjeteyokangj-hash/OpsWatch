export const queue = {
  enqueue: async (name: string, fn: () => Promise<void>): Promise<void> => {
    await fn();
    console.log(`[queue] executed ${name}`);
  }
};
