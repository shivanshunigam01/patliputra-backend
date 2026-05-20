import { Router } from "express";
import { rateLimiters } from "../middleware/rateLimiters.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listServiceKits,
  createServiceKitEnquiry,
  listServiceKitEnquiries,
  getServiceKitEnquiry,
  patchServiceKitEnquiryStatus,
} from "../controllers/serviceKitEnquiryController.js";

const r = Router();

r.get("/kits", listServiceKits);
r.post("/", rateLimiters.leads, createServiceKitEnquiry);

r.get("/", requireAuth, requireRole(["master_admin", "staff"]), listServiceKitEnquiries);
r.get("/:id", requireAuth, requireRole(["master_admin", "staff"]), getServiceKitEnquiry);
r.patch(
  "/:id/status",
  requireAuth,
  requireRole(["master_admin", "staff"]),
  patchServiceKitEnquiryStatus
);

export default r;
