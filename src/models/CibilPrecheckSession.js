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
