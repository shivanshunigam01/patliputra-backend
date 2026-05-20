import mongoose from "mongoose";

const KitItemSchema = new mongoose.Schema(
  {
    srNo: Number,
    itemNo: String,
    description: String,
    quantity: Number,
    mrp: Number,
    value: Number,
  },
  { _id: false }
);

const ServiceKitEnquirySchema = new mongoose.Schema(
  {
    enquiry_number: { type: String, required: true, unique: true, index: true },
    kit_id: { type: String, required: true, index: true },
    kit_title: { type: String, required: true },
    interval_hours: { type: Number, required: true },
    kit_items: { type: [KitItemSchema], default: [] },
    total_mrp: { type: Number, default: 0 },
    total_value: { type: Number, default: 0 },
    customer_name: { type: String, required: true },
    customer_mobile: { type: String, required: true, index: true },
    customer_email: String,
    customer_district: String,
    machine_model: String,
    message: String,
    status: {
      type: String,
      enum: ["new", "contacted", "quoted", "closed", "lost"],
      default: "new",
      index: true,
    },
    client_meta: {
      ip: String,
      userAgent: String,
      referrer: String,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const ServiceKitEnquiry = mongoose.model(
  "ServiceKitEnquiry",
  ServiceKitEnquirySchema
);
