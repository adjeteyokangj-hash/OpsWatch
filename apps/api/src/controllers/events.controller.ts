type AnyFn = (...args: any[]) => any;
const mod = require("../../dist/controllers/events.controller.js") as Record<string, AnyFn>;

export const ingestEventController = mod.ingestEventController as AnyFn;
export const ingestHealthSnapshotController = mod.ingestHealthSnapshotController as AnyFn;
