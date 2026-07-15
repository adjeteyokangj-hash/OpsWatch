import { Router } from "express";
import { requireAdmin } from "../middleware/auth";
import {
  createConnection,
  getConnectionManifestHandler,
  listConnections,
  negotiateConnectionCapabilities,
  patchConnection,
  recordConnectionValidation
} from "../controllers/connections.controller";
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
connectionsRouter.get("/connections/manifests/:mode", getConnectionManifestHandler);
connectionsRouter.post("/connections/negotiate", negotiateConnectionCapabilities);

connectionsRouter.get("/operational-locations", listOperationalLocations);
connectionsRouter.post("/operational-locations", createOperationalLocation);
connectionsRouter.get("/operational-graph", listOperationalGraph);
connectionsRouter.post("/operational-entities", createOperationalEntity);
connectionsRouter.post("/operational-relationships", createOperationalRelationship);
connectionsRouter.post("/operational-relationships/:relationshipId/review", requireAdmin, reviewLearnedOperationalRelationship);
