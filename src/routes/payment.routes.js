import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import axios from "axios";
import { Payment } from "../models/Payment.js";
import { CibilCheck } from "../models/CibilCheck.js";


import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

router.get("/ping", (req, res) => {
  res.json({ ok: true, msg: "payment route alive" });
});

/* =========================
   Env for Surepass
========================= */
const SUREPASS_BASE_URL = (
  process.env.SUREPASS_BASE_URL || "https://kyc-api.surepass.io"
).trim();
const SUREPASS_TOKEN = (process.env.SUREPASS_TOKEN || "").trim();

if (!/^https?:\/\//i.test(SUREPASS_BASE_URL)) {
  console.error(
    `Misconfigured SUREPASS_BASE_URL: "${SUREPASS_BASE_URL}" (must start with http/https)`
  );
}
if (!SUREPASS_TOKEN) {
  console.error("❌ Missing SUREPASS_TOKEN (JWT) in environment");
}

// Build endpoints robustly
const SUREPASS_JSON_ENDPOINT = new URL(
  "/api/v1/credit-report-experian/fetch-report",
  SUREPASS_BASE_URL
).toString();

const SUREPASS_PDF_ENDPOINT = new URL(
  "/api/v1/credit-report-experian/fetch-report-pdf",
  SUREPASS_BASE_URL
).toString();

/* =========================
   Razorpay instance
========================= */
function getRazorpayInstance() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("❌ Razorpay keys missing in environment");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function getScoreBand(score) {
  if (typeof score !== "number") return "unknown";
  if (score >= 750) return "excellent";
  if (score >= 700) return "good";
  if (score >= 650) return "average";
  return "poor";
}

function toNumberOrNull(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maskPan(pan) {
  if (!pan) return null;
  const panStr = String(pan).toUpperCase();
  if (panStr.length < 4) return null;
  return `${panStr.slice(0, 2)}XXXX${panStr.slice(-2)}`;
}

async function saveCibilResult({
  paymentId,
  customerName,
  mobile,
  pan,
  cibilScore,
  rawResponse,
}) {
  const payload = {
    customer_name: customerName,
    mobile,
    pan_masked: maskPan(pan),
    cibil_score: cibilScore,
    score_band: getScoreBand(cibilScore),
    raw_response: rawResponse || {},
    payment_id: paymentId,
  };

  await CibilCheck.findOneAndUpdate({ payment_id: paymentId }, payload, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
}

async function callSurepassCibil({ name, mobile, pan }) {
  const spRes = await axios.post(
    SUREPASS_JSON_ENDPOINT,
    {
      name,
      consent: "Y",
      mobile: String(mobile),
      pan: String(pan).toUpperCase(),
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUREPASS_TOKEN}`,
      },
      timeout: 45000,
      validateStatus: () => true,
    }
  );

  if (spRes.status < 200 || spRes.status >= 300) {
    const providerMessage = spRes.data?.message || "Surepass error";
    const err = new Error(providerMessage);
    err.providerStatus = spRes.status;
    err.providerData = spRes.data;
    throw err;
  }

  const data = spRes.data?.data || {};
  const scoreRaw =
    data?.credit_score ??
    data?.score ??
    data?.cibil_score ??
    data?.credit_report?.Score;

  return {
    providerRaw: data,
    cibilScore: toNumberOrNull(scoreRaw),
    reportNumber: data?.credit_report?.CreditProfileHeader?.ReportNumber ?? null,
    reportDate: data?.credit_report?.CreditProfileHeader?.ReportDate ?? null,
    reportTime: data?.credit_report?.CreditProfileHeader?.ReportTime ?? null,
  };
}

async function upsertPaymentOrder(order) {
  await Payment.findOneAndUpdate(
    { razorpay_order_id: order.id },
    {
      $setOnInsert: {
        purpose: "cibil_check",
        amount: order.amount / 100,
        currency: order.currency,
        razorpay_order_id: order.id,
        status: "created",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/* =========================
   Step 1: Create Razorpay order (₹1)
========================= */
router.post("/razorpay/order", async (req, res) => {
  try {
    // ✅ CREATE INSTANCE HERE (lazy init)
    const razor = getRazorpayInstance();

    const order = await razor.orders.create({
      amount: 1 * 100,
      currency: "INR",
      receipt: `cibil_${Date.now()}`,
    });
    await upsertPaymentOrder(order);

    res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Razorpay order error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   Step 2: Verify payment + fetch CIBIL JSON
========================= */
router.post("/razorpay/verify-cibil", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      name,
      mobile,
      pan,
    } = req.body;

    /* =========================
       Basic validations
    ========================= */
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing Razorpay verification fields" });
    }

    if (!name || !mobile || !pan) {
      return res
        .status(400)
        .json({ ok: false, error: "name, mobile, and pan are required" });
    }

    const mobileStr = String(mobile);
    const panStr = String(pan).toUpperCase();

    if (!/^\d{10}$/.test(mobileStr)) {
      return res
        .status(400)
        .json({ ok: false, error: "mobile must be 10 digits" });
    }

    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(panStr)) {
      return res
        .status(400)
        .json({ ok: false, error: "PAN format invalid (ABCDE1234F)" });
    }

    /* =========================
       Verify Razorpay signature
    ========================= */
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid Razorpay signature" });
    }

    const paymentDoc = await Payment.findOneAndUpdate(
      { razorpay_order_id },
      {
        $set: {
          purpose: "cibil_check",
          amount: 1,
          currency: "INR",
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          status: "paid_pending",
          customer_name: name,
          mobile: mobileStr,
          metadata: {
            pan: panStr,
            cibil_status: "pending",
            cibil_last_error: null,
            cibil_last_attempt_at: new Date(),
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    let surepassResult;
    try {
      surepassResult = await callSurepassCibil({ name, mobile: mobileStr, pan: panStr });
    } catch (spErr) {
      await Payment.updateOne(
        { _id: paymentDoc._id },
        {
          $set: {
            status: "paid_pending",
            "metadata.cibil_status": "pending",
            "metadata.cibil_last_attempt_at": new Date(),
            "metadata.cibil_last_error": {
              message: spErr?.message || "Surepass error",
              status: spErr?.providerStatus || null,
            },
          },
        }
      );

      return res.status(202).json({
        ok: true,
        payment_verified: true,
        cibil_status: "pending",
        message:
          "Payment succeeded but CIBIL provider is temporarily unavailable. Retry shortly.",
        razorpay_order_id,
        razorpay_payment_id,
      });
    }

    await saveCibilResult({
      paymentId: razorpay_payment_id,
      customerName: name,
      mobile: mobileStr,
      pan: panStr,
      cibilScore: surepassResult.cibilScore,
      rawResponse: surepassResult.providerRaw,
    });

    await Payment.updateOne(
      { _id: paymentDoc._id },
      {
        $set: {
          status: "paid",
          "metadata.cibil_status": "success",
          "metadata.cibil_last_error": null,
          "metadata.cibil_last_attempt_at": new Date(),
        },
      }
    );

    /* =========================
       Final response to frontend
    ========================= */
    return res.json({
      ok: true,
      score: surepassResult.cibilScore,
      report_number: surepassResult.reportNumber,
      report_date: surepassResult.reportDate,
      report_time: surepassResult.reportTime,
      raw: surepassResult.providerRaw,
    });
  } catch (err) {
    const ax = err && err.isAxiosError ? err : null;
    const status = ax?.response?.status || 500;

    console.error("verify-cibil fatal:", status, err?.message);

    return res.status(status).json({
      ok: false,
      source: "server",
      error: "Failed to verify payment or fetch CIBIL",
    });
  }
});

router.post("/razorpay/retry-cibil", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, name, mobile, pan } = req.body;
    if (!razorpay_order_id && !razorpay_payment_id) {
      return res.status(400).json({
        ok: false,
        error: "razorpay_order_id or razorpay_payment_id is required",
      });
    }

    const payment = await Payment.findOne({
      $or: [
        { razorpay_order_id: razorpay_order_id || null },
        { razorpay_payment_id: razorpay_payment_id || null },
      ],
    });

    if (!payment) {
      return res.status(404).json({ ok: false, error: "Payment not found" });
    }

    const resolvedName = name || payment.customer_name;
    const resolvedMobile = String(mobile || payment.mobile || "");
    const resolvedPan = String(pan || payment.metadata?.pan || "").toUpperCase();

    if (!resolvedName || !resolvedMobile || !resolvedPan) {
      return res.status(400).json({
        ok: false,
        error: "name, mobile and pan are required to retry CIBIL",
      });
    }

    try {
      const surepassResult = await callSurepassCibil({
        name: resolvedName,
        mobile: resolvedMobile,
        pan: resolvedPan,
      });

      await saveCibilResult({
        paymentId: payment.razorpay_payment_id || payment.razorpay_order_id,
        customerName: resolvedName,
        mobile: resolvedMobile,
        pan: resolvedPan,
        cibilScore: surepassResult.cibilScore,
        rawResponse: surepassResult.providerRaw,
      });

      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: "paid",
            customer_name: resolvedName,
            mobile: resolvedMobile,
            "metadata.pan": resolvedPan,
            "metadata.cibil_status": "success",
            "metadata.cibil_last_error": null,
            "metadata.cibil_last_attempt_at": new Date(),
          },
        }
      );

      return res.json({
        ok: true,
        cibil_status: "success",
        score: surepassResult.cibilScore,
        report_number: surepassResult.reportNumber,
        report_date: surepassResult.reportDate,
        report_time: surepassResult.reportTime,
        raw: surepassResult.providerRaw,
      });
    } catch (spErr) {
      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: "paid_pending",
            customer_name: resolvedName,
            mobile: resolvedMobile,
            "metadata.pan": resolvedPan,
            "metadata.cibil_status": "pending",
            "metadata.cibil_last_attempt_at": new Date(),
            "metadata.cibil_last_error": {
              message: spErr?.message || "Surepass error",
              status: spErr?.providerStatus || null,
            },
          },
        }
      );

      return res.status(202).json({
        ok: true,
        cibil_status: "pending",
        message: "CIBIL provider still unavailable. Please retry shortly.",
        razorpay_order_id: payment.razorpay_order_id,
        razorpay_payment_id: payment.razorpay_payment_id,
      });
    }
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Failed to retry CIBIL fetch",
      details: err?.message,
    });
  }
});


/* =========================
   Step 3: Fetch Experian PDF (Direct API)
   POST /payment/experian-pdf
========================= */
router.post("/experian-pdf", async (req, res) => {
  try {
    const { name, mobile, pan, consent = "Y" } = req.body;

    if (!name || !mobile || !pan) {
      return res
        .status(400)
        .json({ ok: false, error: "name, mobile, and pan are required" });
    }

    let spRes;
    try {
      spRes = await axios.post(
        SUREPASS_PDF_ENDPOINT,
        { name, consent, mobile, pan },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUREPASS_TOKEN}`,
          },
          timeout: 45000,
          validateStatus: () => true,
        }
      );
    } catch (networkErr) {
      spRes = await axios.post(
        SUREPASS_PDF_ENDPOINT,
        { name, consent, mobile, pan },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUREPASS_TOKEN}`,
          },
          timeout: 45000,
          validateStatus: () => true,
        }
      );
    }

    if (spRes.status < 200 || spRes.status >= 300) {
      return res.status(502).json({
        ok: false,
        error: spRes.data?.message || "Surepass PDF API failed",
      });
    }

    const link =
      spRes.data?.data?.credit_report_link ||
      spRes.data?.data?.report_url ||
      spRes.data?.credit_report_link;

    if (!link) {
      throw new Error("No PDF link found in Surepass response");
    }

    return res.json({ ok: true, credit_report_link: link });
  } catch (err) {
    console.error("experian-pdf error:", err?.response?.data || err.message);
    res.status(500).json({ ok: false, error: "Failed to fetch Experian PDF" });
  }
});

export default router;