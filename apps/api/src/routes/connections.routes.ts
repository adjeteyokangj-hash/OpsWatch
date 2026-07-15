import { Router } from "express";
import { requireAdmin } from "../middleware/auth";
import {
  createConnection,
  discoverConnection,
  getConnectionManifestHandler,
  listConnections,
  negotiateConnectionCapabilities,
  patchConnection,
  recordConnectionValidation,
  testConnection
} from "../controllers/connections.controller";
import { createChangeLedger, listChangeLedger } from "../controllers/change-ledger.controller";
import {
  createOperationalEntity,
  createOperationalLocation,
  createOperationalRelationship,
  listOperationalGraph,
  listOperationalLocations,
  reviewLearnedOperationalRelationship
} from "../controllers/operational-graph.controller";

export const connectionsRouter = Router();

connectionsRouter.get("/connections", listConnections);
connectionsRouter.post("/connections", createConnection);
connectionsRouter.patch("/connections/:connectionId", patchConnection);
connectionsRouter.post("/connections/:connectionId/validation", recordConnectionValidation);
connectionsRouter.post("/connections/:connectionId/test", testConnection);
connectionsRouter.post("/connections/:connectionId/discover", discoverConnection);
connectionsRouter.get("/connections/manifests/:mode", getConnectionManifestHandler);
connectionsRouter.post("/connections/negotiate", negotiateConnectionCapabilities);
connectionsRouter.get("/change-ledger", listChangeLedger);
connectionsRouter.post("/change-ledger", createChangeLedger);

connectionsRouter.get("/operational-locations", listOperationalLocations);
connectionsRouter.post("/operational-locations", createOperationalLocation);
connectionsRouter.get("/operational-graph", listOperationalGraph);
connectionsRouter.post("/operational-entities", createOperationalEntity);
connectionsRouter.post("/operational-relationships", createOperationalRelationship);
connectionsRouter.post("/operational-relationships/:relationshipId/review", requireAdmin, reviewLearnedOperationalRelationship);
