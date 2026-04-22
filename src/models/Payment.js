import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    purpose: { type: String, enum: ["cibil_check", "other"], default: "cibil_check", index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    razorpay_order_id: { type: String, required: true, unique: true },
    razorpay_payment_id: String,
    razorpay_signature: String,
    status: {
      type: String,
      enum: ["created", "paid_pending", "paid", "failed"],
      default: "created",
      index: true,
    },
    customer_name: String,
    mobile: String,
    metadata: { type: Object, default: {} },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

export const Payment = mongoose.model("Payment", PaymentSchema);
