import { CibilCheck } from "../models/CibilCheck.js";

const scoreBand = (score) => {
  if (typeof score !== "number") return "unknown";
  if (score >= 750) return "excellent";
  if (score >= 700) return "good";
  if (score >= 650) return "average";
  return "poor";
};

export const syncCibilFromPayment = async (req, res) => {
  try {
    const {
      customer_name,
      mobile,
      pan,
      dob,
      cibil_score,
      raw_response,
      linked_lead_id,
      payment_id,
    } = req.body;

    if (!customer_name || !mobile || !pan || cibil_score === undefined || cibil_score === null) {
      return res.status(400).json({
        ok: false,
        error: "Missing required CIBIL data",
      });
    }

    const panU = String(pan).toUpperCase().replace(/\s/g, "");

    const record = await CibilCheck.create({
      customer_name,
      mobile,
      pan: panU,
      pan_masked: null,
      dob: dob || null,
      cibil_score,
      score_band: scoreBand(cibil_score),
      raw_response: raw_response || {},
      linked_lead_id: linked_lead_id || null,
      payment_id: payment_id || null,
      checked_at: new Date(),
    });

    return res.json({
      ok: true,
      cibil_id: record._id,
    });
  } catch (err) {
    console.error("CIBIL sync error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to sync CIBIL record",
    });
  }
};
