import mongoose from "mongoose";

/**
 * One-time CIBIL + PDF fetch before payment. Consumed on successful Razorpay verify.
 * Stops users from paying if Surepass / PDF fails. Fields match verify payload.
 */
const CibilPrecheckSessionSchema = new mongoose.Schema(
  {
    precheckId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    mobile: { type: String, required: true },
    pan: { type: String, required: true },
    aadhaarNumber: { type: String, required: true },
    /**
     * experian = Experian bureau JSON + Experian PDF API
     * cibil_credit_report = CIBIL Credit Report PDF API (fetch-report-pdf on credit-report-cibil)
     */
    reportKind: {
      type: String,
      enum: ["experian", "cibil_credit_report"],
      default: "experian",
    },
    /** Required when reportKind is cibil_credit_report (male | female | other) */
    gender: { type: String },
    cibilScore: { type: Number },
    reportNumber: { type: String },
    reportDate: { type: String },
    reportTime: { type: String },
    providerRaw: { type: Object, default: {} },
    experianPdfLink: { type: String },
    status: {
      type: String,
      enum: ["ready", "consumed", "expired"],
      default: "ready",
      index: true,
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

CibilPrecheckSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CibilPrecheckSession = mongoose.model(
  "CibilPrecheckSession",
  CibilPrecheckSessionSchema
);
