import { PrismaClient } from "@prisma/client";
import { seedNobleExpressGraph } from "./lib/noble-express-graph.seed";

const prisma = new PrismaClient();

void seedNobleExpressGraph(prisma)
  .then((result) => {
    console.log("NOBLE_EXPRESS_GRAPH_READY");
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error("NOBLE_EXPRESS_GRAPH_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
