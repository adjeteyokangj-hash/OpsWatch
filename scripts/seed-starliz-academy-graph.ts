import { PrismaClient } from "@prisma/client";
import { seedStarlizAcademyGraph } from "./lib/starliz-academy-graph.seed";

const prisma = new PrismaClient();

void seedStarlizAcademyGraph(prisma)
  .then((result) => {
    console.log("STARLIZ_ACADEMY_GRAPH_READY");
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error("STARLIZ_ACADEMY_GRAPH_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
