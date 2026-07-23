import mongoose from "mongoose";

const FaqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
  },
  { _id: false }
);

const SeoLandingPageSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      enum: ["jcb", "ashok-leyland", "switch", "used-jcb"],
      index: true,
    },
    districtSlug: { type: String, required: true, index: true },
    districtName: { type: String, required: true },
    path: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    titleHi: { type: String, default: "" },
    metaDescription: { type: String, required: true },
    metaDescriptionHi: { type: String, default: "" },
    h1: { type: String, required: true },
    h1Hi: { type: String, default: "" },
    introEn: { type: String, default: "" },
    introHi: { type: String, default: "" },
    bodyEn: { type: String, default: "" },
    bodyHi: { type: String, default: "" },
    keywords: { type: [String], default: [] },
    faqs: { type: [FaqSchema], default: [] },
    ctaText: { type: String, default: "Abhi Call Karein" },
    isActive: { type: Boolean, default: true, index: true },
    priority: { type: Number, default: 0.7 },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

SeoLandingPageSchema.index({ category: 1, districtSlug: 1 }, { unique: true });

export default mongoose.model("SeoLandingPage", SeoLandingPageSchema);
