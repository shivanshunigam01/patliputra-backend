import { Router } from "express";
import { rateLimiters } from "../../middleware/rateLimiters.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { createCibilPaymentOrder, verifyCibilPaymentAndCheck, listCibilChecks, cibilAnalytics } from "../../controllers/cibilController.js";

const r = Router();

// Public (payment + verification)
r.post("/create-order", rateLimiters.cibil, createCibilPaymentOrder);
r.post("/verify-and-check", rateLimiters.cibil, verifyCibilPaymentAndCheck);

// Admin (list + analytics)
r.get("/", requireAuth, requireRole(["master_admin","staff"]), listCibilChecks);
r.get("/analytics", requireAuth, requireRole(["master_admin","staff"]), cibilAnalytics);

// POST /cibil/sync-from-payment → cibilSync.routes.js

export default r;
