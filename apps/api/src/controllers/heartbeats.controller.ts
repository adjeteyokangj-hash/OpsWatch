type AnyFn = (...args: any[]) => any;
const mod = require("../../dist/controllers/heartbeats.controller.js") as Record<string, AnyFn>;

export const ingestHeartbeatController = mod.ingestHeartbeatController as AnyFn;
