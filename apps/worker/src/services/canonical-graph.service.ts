import { createCanonicalGraphService } from "@opswatch/shared";
import { prisma } from "../lib/prisma";

/** Authoritative worker graph writer shared with the API implementation. */
export const canonicalGraph = createCanonicalGraphService(prisma);
