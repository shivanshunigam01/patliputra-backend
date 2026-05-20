import { ServiceKitEnquiry } from "../models/ServiceKitEnquiry.js";
import { getKitById } from "../data/jcbServiceKits.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok, created, fail } from "../utils/apiResponse.js";

function makeEnquiryNumber() {
  return `SK-${Date.now().toString(36).toUpperCase()}`;
}

function mapEnquiry(doc) {
  return {
    id: doc._id.toString(),
    enquiryNumber: doc.enquiry_number,
    kitId: doc.kit_id,
    kitTitle: doc.kit_title,
    intervalHours: doc.interval_hours,
    kitItems: doc.kit_items,
    totalMrp: doc.total_mrp,
    totalValue: doc.total_value,
    customerName: doc.customer_name,
    customerMobile: doc.customer_mobile,
    customerEmail: doc.customer_email,
    customerDistrict: doc.customer_district,
    machineModel: doc.machine_model,
    message: doc.message,
    status: doc.status,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

export const listServiceKits = asyncHandler(async (_req, res) => {
  const { JCB_SERVICE_KITS } = await import("../data/jcbServiceKits.js");
  return ok(res, JCB_SERVICE_KITS);
});

export const createServiceKitEnquiry = asyncHandler(async (req, res) => {
  const {
    kit_id,
    customer_name,
    customer_mobile,
    customer_email,
    customer_district,
    machine_model,
    message,
  } = req.body;

  if (!kit_id || !customer_name || !customer_mobile) {
    return fail(res, "VALIDATION_ERROR", "kit_id, customer_name and customer_mobile are required");
  }

  const mobile = String(customer_mobile).replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(mobile)) {
    return fail(res, "VALIDATION_ERROR", "Enter a valid 10-digit Indian mobile number");
  }

  const kit = getKitById(kit_id);
  if (!kit) {
    return fail(res, "NOT_FOUND", "Invalid service kit selected");
  }

  const enquiry = await ServiceKitEnquiry.create({
    enquiry_number: makeEnquiryNumber(),
    kit_id: kit.id,
    kit_title: kit.title,
    interval_hours: kit.intervalHours,
    kit_items: kit.items,
    total_mrp: kit.totalMrp,
    total_value: kit.totalValue,
    customer_name: customer_name.trim(),
    customer_mobile: mobile,
    customer_email: customer_email?.trim() || undefined,
    customer_district: customer_district?.trim() || undefined,
    machine_model: machine_model?.trim() || undefined,
    message: message?.trim() || undefined,
    client_meta: {
      ip: req.clientInfo?.ip,
      userAgent: req.clientInfo?.userAgent,
      referrer: req.clientInfo?.referrer,
    },
  });

  return created(res, {
    id: enquiry._id.toString(),
    enquiry_number: enquiry.enquiry_number,
    kit_title: enquiry.kit_title,
  });
});

export const listServiceKitEnquiries = asyncHandler(async (req, res) => {
  const { status, kit_id, search } = req.query;
  const q = {};
  if (status) q.status = status;
  if (kit_id) q.kit_id = kit_id;
  if (search) {
    q.$or = [
      { customer_name: { $regex: search, $options: "i" } },
      { customer_mobile: { $regex: search, $options: "i" } },
      { enquiry_number: { $regex: search, $options: "i" } },
      { kit_title: { $regex: search, $options: "i" } },
    ];
  }

  const items = await ServiceKitEnquiry.find(q).sort({ created_at: -1 });
  return ok(res, items.map(mapEnquiry));
});

export const getServiceKitEnquiry = asyncHandler(async (req, res) => {
  const doc = await ServiceKitEnquiry.findById(req.params.id);
  if (!doc) return fail(res, "NOT_FOUND", "Enquiry not found", null, 404);
  return ok(res, mapEnquiry(doc));
});

export const patchServiceKitEnquiryStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ["new", "contacted", "quoted", "closed", "lost"];
  if (!allowed.includes(status)) {
    return fail(res, "VALIDATION_ERROR", "Invalid status");
  }

  const doc = await ServiceKitEnquiry.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  );
  if (!doc) return fail(res, "NOT_FOUND", "Enquiry not found", null, 404);
  return ok(res, mapEnquiry(doc));
});
