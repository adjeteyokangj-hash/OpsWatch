import { createCanonicalGraphService } from "@opswatch/shared";
import { prisma } from "../lib/prisma";

/** Authoritative API graph writer. Do not write OperationalEntity or
 * OperationalRelationship directly outside migrations and maintenance tools. */
export const canonicalGraph = createCanonicalGraphService(prisma);
