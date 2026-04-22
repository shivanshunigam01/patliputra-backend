import mongoose from "mongoose";

const CibilCheckSchema = new mongoose.Schema(
  {
    customer_name: { type: String, required: true },
    mobile: { type: String, required: true, index: true },
    /** Full PAN (uppercase) as entered by the customer; used in admin. */
    pan: { type: String, index: true },
    /** @deprecated legacy masked display; new records set full `pan` only. */
    pan_masked: String,
    dob: String,
    cibil_score: Number,
    score_band: {
      type: String,
      enum: ["excellent", "good", "average", "poor", "unknown"],
      default: "unknown",
      index: true,
    },
    raw_response: { type: Object, default: {} },

    /** Surepass / Experian short-lived PDF URL (cache for repeat requests). */
    experian_pdf_link: { type: String },
    /** Public path to saved PDF, e.g. /uploads/cibil-reports/… (local disk, like brochures). */
    cibil_pdf_report_url: { type: String },

    linked_lead_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
    },

    // 🔥 CHANGE THIS
    payment_id: {
      type: String, // Razorpay payment ID
      index: true,
    },

    checked_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);


export const CibilCheck = mongoose.model("CibilCheck", CibilCheckSchema);
