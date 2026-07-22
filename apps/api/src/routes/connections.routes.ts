import { Router } from "express";
import { requireAdmin } from "../middleware/auth";
import {
  createConnection,
  deleteConnection,
  disableConnection,
  discoverConnection,
  getConnectionManifestHandler,
  listConnections,
  negotiateConnectionCapabilities,
  patchConnection,
  reactivateConnection,
  recordConnectionValidation,
  rotateConnectionCredential,
  syncConnection,
  testConnection,
  testUnsavedConnectionHandler
} from "../controllers/connections.controller";
import { discoverConnectionTopologyHandler } from "../controllers/connection-topology.controller";
import { createChangeLedger, listChangeLedger } from "../controllers/change-ledger.controller";
import {
  createOperationalEntity,
  createOperationalLocation,
  createOperationalRelationship,
  getOperationalGraphHealthHandler,
  listOperationalGraph,
  listOperationalLocations,
  observeOperationalRelationshipHandler,
  proposeLearnedOperationalRelationship,
  recalculateOperationalGraphHealthHandler,
  reviewLearnedOperationalRelationship
} from "../controllers/operational-graph.controller";

export const connectionsRouter = Router();

connectionsRouter.get("/connections", listConnections);
connectionsRouter.post("/connections", createConnection);
connectionsRouter.patch("/connections/:connectionId", patchConnection);
connectionsRouter.post("/connections/:connectionId/validation", recordConnectionValidation);
connectionsRouter.post("/connections/test", testUnsavedConnectionHandler);
connectionsRouter.post("/connections/:connectionId/test", testConnection);
connectionsRouter.post("/connections/:connectionId/sync", syncConnection);
connectionsRouter.post("/connections/:connectionId/discover", discoverConnection);
connectionsRouter.post(
  "/connections/:connectionId/discover-topology",
  requireAdmin,
  discoverConnectionTopologyHandler
);
connectionsRouter.post("/connections/:connectionId/disable", requireAdmin, disableConnection);
connectionsRouter.post("/connections/:connectionId/reactivate", requireAdmin, reactivateConnection);
connectionsRouter.post("/connections/:connectionId/rotate-credential", requireAdmin, rotateConnectionCredential);
connectionsRouter.delete("/connections/:connectionId", requireAdmin, deleteConnection);
connectionsRouter.get("/connections/manifests/:mode", getConnectionManifestHandler);
connectionsRouter.post("/connections/negotiate", negotiateConnectionCapabilities);
connectionsRouter.get("/change-ledger", listChangeLedger);
connectionsRouter.post("/change-ledger", createChangeLedger);

connectionsRouter.get("/operational-locations", listOperationalLocations);
connectionsRouter.post("/operational-locations", createOperationalLocation);
connectionsRouter.get("/operational-graph", listOperationalGraph);
connectionsRouter.get("/operational-graph/health", getOperationalGraphHealthHandler);
connectionsRouter.post("/operational-graph/health/recalculate", requireAdmin, recalculateOperationalGraphHealthHandler);
connectionsRouter.post("/operational-entities", createOperationalEntity);
connectionsRouter.post("/operational-relationships", createOperationalRelationship);
connectionsRouter.post("/operational-relationships/propose-learned", requireAdmin, proposeLearnedOperationalRelationship);
connectionsRouter.post("/operational-relationships/observe", observeOperationalRelationshipHandler);
connectionsRouter.post("/operational-relationships/:relationshipId/review", requireAdmin, reviewLearnedOperationalRelationship);
