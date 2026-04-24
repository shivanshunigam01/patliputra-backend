import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";
import { Payment } from "../models/Payment.js";
import { CibilCheck } from "../models/CibilCheck.js";
import { CibilPrecheckSession } from "../models/CibilPrecheckSession.js";
import multer from "multer";

import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

const AADHAAR_UPLOAD_DIR = path.join(process.cwd(), "uploads", "cibil-aadhaar");
if (!fs.existsSync(AADHAAR_UPLOAD_DIR)) {
  fs.mkdirSync(AADHAAR_UPLOAD_DIR, { recursive: true });
}

const aadhaarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AADHAAR_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".pdf";
    cb(
      null,
      `aadhaar_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`
    );
  },
});

const aadhaarUploadMiddleware = multer({
  storage: aadhaarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
    ].includes(file.mimetype);
    if (!ok) {
      return cb(new Error("Aadhaar file must be PDF, PNG, or JPEG (max 5MB)."));
    }
    cb(null, true);
  },
});

function normalizeAadhaar12(value) {
  const d = String(value || "").replace(/\D/g, "");
  return d.length === 12 ? d : null;
}

router.get("/ping", (req, res) => {
  res.json({ ok: true, msg: "payment route alive" });
});

/** Public fee hints for CIBIL UI (INR) */
router.get("/cibil-pricing", (req, res) => {
  res.json({
    ok: true,
    experian_in_inr: getAmountsForReportKind("experian").inr,
    cibil_credit_report_in_inr: getAmountsForReportKind("cibil_credit_report")
      .inr,
  });
});

/* =========================
   Env for Surepass
========================= */
const SUREPASS_BASE_URL = (
  process.env.SUREPASS_BASE_URL || "https://kyc-api.surepass.io"
).trim();
const SUREPASS_TOKEN = (process.env.SUREPASS_TOKEN || "").trim();

function getAmountsForReportKind(reportKind) {
  const experianInr = Math.round(Number(process.env.CIBIL_CHECK_AMOUNT_INR || 1));
  const cibilCreditInr = Math.round(
    Number(process.env.CIBIL_CREDIT_REPORT_AMOUNT_INR || 1)
  );
  const inr = reportKind === "cibil_credit_report" ? cibilCreditInr : experianInr;
  return { inr, paise: inr * 100 };
}

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

/** CIBIL Credit Report (bureau) PDF – distinct from Experian. */
const SUREPASS_CIBIL_CREDIT_PDF_ENDPOINT = new URL(
  "/api/v1/credit-report-cibil/fetch-report-pdf",
  SUREPASS_BASE_URL
).toString();

/* Local PDF storage (same style as product brochure: uploads/…) */
const CIBIL_PDF_DIR = path.join(process.cwd(), "uploads", "cibil-reports");

function ensureCibilPdfDir() {
  if (!fs.existsSync(CIBIL_PDF_DIR)) {
    fs.mkdirSync(CIBIL_PDF_DIR, { recursive: true });
  }
}

/** @returns {Promise<string|null>} public path e.g. /uploads/cibil-reports/….pdf or null on failure */
async function downloadExperianPdfToLocalDisk(sourceUrl) {
  if (!sourceUrl || !String(sourceUrl).startsWith("http")) return null;
  try {
    ensureCibilPdfDir();
    const spRes = await axios.get(String(sourceUrl), {
      responseType: "arraybuffer",
      maxContentLength: 25 * 1024 * 1024,
      timeout: 120000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const name = `cibil_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.pdf`;
    const filePath = path.join(CIBIL_PDF_DIR, name);
    await fs.promises.writeFile(filePath, Buffer.from(spRes.data));
    const publicPath = "/" + path.join("uploads", "cibil-reports", name).replace(/\\/g, "/");
    return publicPath;
  } catch (err) {
    console.error("downloadExperianPdfToLocalDisk:", err?.message || err);
    return null;
  }
}

/** Browser-openable URL (brochure-style paths are relative to API host). */
function publicFileAbsoluteUrl(req, publicPath) {
  if (!publicPath) return publicPath;
  if (/^https?:\/\//i.test(publicPath)) return publicPath;
  const fromEnv = (process.env.API_PUBLIC_BASE_URL || process.env.SERVER_PUBLIC_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (fromEnv) return `${fromEnv}${publicPath.startsWith("/") ? publicPath : `/${publicPath}`}`;
  const host = req.get("x-forwarded-host") || req.get("host");
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https")
    .split(",")[0]
    .trim();
  const origin = `${proto}://${host}`.replace(/\/$/, "");
  return `${origin}${publicPath.startsWith("/") ? publicPath : `/${publicPath}`}`;
}

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

async function updateLatestCibilPdfFields(mobileStr, panFull, fields) {
  const panU = String(panFull).toUpperCase();
  const legacyMask = maskPan(panU);
  const $set = {};
  if (fields.experian_pdf_link) $set.experian_pdf_link = fields.experian_pdf_link;
  if (fields.cibil_pdf_report_url) $set.cibil_pdf_report_url = fields.cibil_pdf_report_url;
  if (!Object.keys($set).length) return;
  const $or = [{ pan: panU }];
  if (legacyMask) $or.push({ pan_masked: legacyMask });
  await CibilCheck.findOneAndUpdate(
    { mobile: mobileStr, $or },
    { $set },
    { sort: { checked_at: -1 } }
  );
}

/**
 * Ensure nested objects can be stored in MongoDB (no `.` in keys, no `$` prefix).
 */
function sanitizeObjectForMongo(value, depth = 0) {
  if (depth > 20) return { _truncated: true };
  if (value == null) return value;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeObjectForMongo(v, depth + 1));
  if (t === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      const safe = k.startsWith("$") ? `_dollar_${k.slice(1)}` : k.replace(/\./g, "·");
      out[safe] = sanitizeObjectForMongo(value[k], depth + 1);
    }
    return out;
  }
  return String(value);
}

async function saveCibilResult({
  paymentId,
  customerName,
  mobile,
  pan,
  cibilScore,
  rawResponse,
  aadhaarNumber = null,
  aadhaarDocumentUrl = null,
}) {
  const panU = String(pan).toUpperCase();
  const rawSafe = sanitizeObjectForMongo(rawResponse || {});

  const payload = {
    customer_name: customerName,
    mobile,
    pan: panU,
    pan_masked: null,
    cibil_score: cibilScore,
    score_band: getScoreBand(cibilScore),
    raw_response: rawSafe,
    payment_id: paymentId,
  };
  if (aadhaarNumber) payload.aadhaar_number = aadhaarNumber;
  if (aadhaarDocumentUrl) payload.aadhaar_document_url = aadhaarDocumentUrl;

  await CibilCheck.findOneAndUpdate({ payment_id: paymentId }, payload, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
}

const PRECHECK_TTL_MS = 30 * 60 * 1000;

function normalizePersonName(n) {
  return String(n || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Fetches Experian credit report PDF from Surepass (same product as precheck JSON, PDF step after payment).
 * Response shape: data.credit_score (string or number), data.credit_report_link, etc.
 * @returns {{ ok: true, link: string, data: object } | { ok: false, status: number, error: string }}
 */
async function fetchExperianPdfLinkFromSurepass({
  name,
  mobileStr,
  panStr,
  consent = "Y",
}) {
  const postOpts = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUREPASS_TOKEN}`,
    },
    timeout: 45000,
    validateStatus: () => true,
  };
  const body = { name, consent: consent || "Y", mobile: mobileStr, pan: panStr };
  let spRes;
  try {
    spRes = await axios.post(SUREPASS_PDF_ENDPOINT, body, postOpts);
  } catch (e1) {
    try {
      spRes = await axios.post(SUREPASS_PDF_ENDPOINT, body, postOpts);
    } catch (e2) {
      return {
        ok: false,
        status: 503,
        error:
          e2?.message ||
          e1?.message ||
          "Surepass PDF API unreachable. Try again in a moment.",
      };
    }
  }

  if (!spRes || spRes.status < 200 || spRes.status >= 300) {
    return {
      ok: false,
      status: spRes?.status || 502,
      error: spRes?.data?.message || spRes?.data?.error || "Surepass PDF API failed",
    };
  }

  const link =
    spRes.data?.data?.credit_report_link ||
    spRes.data?.data?.report_url ||
    spRes.data?.credit_report_link;

  if (!link) {
    return { ok: false, status: 502, error: "No PDF link in provider response" };
  }
  if (spRes.data && spRes.data.success === false) {
    return {
      ok: false,
      status: 502,
      error: spRes.data?.message || "Experian PDF API returned success: false",
    };
  }
  return { ok: true, link, data: spRes.data };
}

/**
 * CIBIL Credit Report (bureau) PDF – Surepass
 * @returns {{ ok: true, link: string, data: object } | { ok: false, status: number, error: string }}
 */
async function fetchCibilCreditReportPdfFromSurepass({
  name,
  mobileStr,
  panStr,
  gender = "male",
  consent = "Y",
}) {
  const body = {
    name: String(name || "").trim(),
    mobile: mobileStr,
    pan: String(panStr).toUpperCase(),
    gender: String(gender || "male").toLowerCase(),
    consent: consent || "Y",
  };

  const cibilPostOpts = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUREPASS_TOKEN}`,
    },
    timeout: 120000,
    validateStatus: () => true,
  };
  let spRes;
  try {
    spRes = await axios.post(
      SUREPASS_CIBIL_CREDIT_PDF_ENDPOINT,
      body,
      cibilPostOpts
    );
  } catch (e1) {
    try {
      spRes = await axios.post(
        SUREPASS_CIBIL_CREDIT_PDF_ENDPOINT,
        body,
        cibilPostOpts
      );
    } catch (e2) {
      return {
        ok: false,
        status: 503,
        error:
          e2?.message ||
          e1?.message ||
          "CIBIL Credit Report PDF API unreachable. Try again in a moment.",
      };
    }
  }

  if (!spRes || spRes.status < 200 || spRes.status >= 300) {
    return {
      ok: false,
      status: spRes?.status || 502,
      error: spRes?.data?.message || spRes?.data?.error || "CIBIL Credit Report PDF API failed",
    };
  }

  if (spRes.data && spRes.data.success === false) {
    return {
      ok: false,
      status: 502,
      error: spRes.data?.message || "CIBIL PDF API returned success: false",
    };
  }

  const d = spRes.data?.data ?? spRes.data;
  const link =
    d?.credit_report_link || d?.report_url || spRes.data?.credit_report_link;

  if (!link) {
    return { ok: false, status: 502, error: "No PDF link in CIBIL credit report response" };
  }
  return { ok: true, link, data: spRes.data };
}

function normalizeReportKind(body) {
  const k = String(
    body?.report_kind || body?.reportKind || "experian"
  ).toLowerCase();
  if (k === "cibil_credit_report" || k === "cibil_report" || k === "cibil")
    return "cibil_credit_report";
  return "experian";
}

/**
 * CIBIL bureau product vs Experian: any trusted source that says
 * cibil_credit_report wins (session, payment metadata, or form).
 */
function resolveProductReportKind({ fromSession, fromPaymentMetadata, fromClient } = {}) {
  const candidates = [fromSession, fromPaymentMetadata, fromClient].filter(
    (x) => x != null && String(x).trim() !== ""
  );
  if (!candidates.length) return "experian";
  const kindsNorm = candidates.map((c) => normalizeReportKind({ report_kind: c }));
  if (kindsNorm.includes("cibil_credit_report")) return "cibil_credit_report";
  return normalizeReportKind({ report_kind: candidates[0] });
}

function normalizeGenderInput(g) {
  const s = String(g || "")
    .toLowerCase()
    .trim();
  if (["male", "m"].includes(s)) return "male";
  if (["female", "f"].includes(s)) return "female";
  if (["other", "o", "transgender", "trans"].includes(s)) return "other";
  return null;
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
      timeout: 60000,
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

function isRetryableNetworkError(err) {
  if (!err) return false;
  const code = err.code || err.cause?.code;
  if (
    ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EPIPE", "EAI_AGAIN", "ENOTFOUND"].includes(
      String(code)
    )
  ) {
    return true;
  }
  const msg = String(err.message || err.toString() || "");
  if (/ECONNRESET|ETIMEDOUT|socket hang up|network|aborted|ECONN/i.test(msg)) {
    return true;
  }
  return false;
}

/** Surepass is occasionally flaky; retry transient network + 502/503/504 from provider. */
async function callSurepassCibilWithRetry(
  { name, mobile, pan },
  { maxAttempts = 3, delayMs = 700 } = {}
) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callSurepassCibil({ name, mobile, pan });
    } catch (err) {
      lastErr = err;
      const st = err?.providerStatus;
      const shouldRetryStatus =
        st === 502 || st === 503 || st === 504 || st === 429;
      const shouldRetry = shouldRetryStatus || (isRetryableNetworkError(err) && !st);

      if (shouldRetry && attempt < maxAttempts) {
        console.warn(
          `callSurepassCibil retry ${attempt + 1}/${maxAttempts}:`,
          st || err?.code || err?.message
        );
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function upsertPaymentOrder(
  order,
  precheckId = null,
  meta = {}
) {
  const reportKind = meta.reportKind || "experian";
  const setOnInsert = {
    purpose: "cibil_check",
    amount: order.amount / 100,
    currency: order.currency,
    razorpay_order_id: order.id,
    status: "created",
  };
  const update = { $setOnInsert: setOnInsert };
  if (precheckId) {
    update.$set = {
      "metadata.precheck_id": precheckId,
      "metadata.cibil_report_kind": reportKind,
    };
  }
  await Payment.findOneAndUpdate(
    { razorpay_order_id: order.id },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * After payment, fetch the correct PDF (Experian vs CIBIL credit report), persist, then return.
 * Precheck used Experian JSON for identity; PDF step follows selected reportKind.
 */
async function commitCibilFromPrecheckSession(
  req,
  paymentDoc,
  {
    razorpay_payment_id,
    aadhaar_number,
    aadhaar_document_url,
    client_report_kind: clientReportKind,
  },
  session
) {
  let leanSession = null;
  try {
    if (session?._id) {
      leanSession = await CibilPrecheckSession.findById(session._id).lean();
    }
  } catch (e) {
    console.warn("commit: precheck session reload failed", e?.message);
  }
  const s0 = leanSession || (typeof session?.toObject === "function" ? session.toObject() : session);
  const reportKind = resolveProductReportKind({
    fromSession: s0?.reportKind,
    fromPaymentMetadata: paymentDoc?.metadata?.cibil_report_kind,
    fromClient: clientReportKind,
  });
  const isCibilCredit = reportKind === "cibil_credit_report";

  const baseRaw =
    session.providerRaw &&
    typeof session.providerRaw === "object" &&
    !Array.isArray(session.providerRaw)
      ? { ...session.providerRaw }
      : {};
  let mergedRaw = baseRaw;
  let finalScore = session.cibilScore;
  let reportNumber = session.reportNumber;
  let reportDate = session.reportDate;
  let reportTime = session.reportTime;
  let providerPdfLink = isCibilCredit ? null : session.experianPdfLink;

  if (isCibilCredit) {
    console.log("commit: CIBIL bureau fetch-report-pdf (credit-report-cibil)");
    const pdfRes = await fetchCibilCreditReportPdfFromSurepass({
      name: session.name,
      mobileStr: session.mobile,
      panStr: session.pan,
      gender: session.gender || "male",
      consent: "Y",
    });
    if (pdfRes.ok) {
      providerPdfLink = pdfRes.link;
      const block = pdfRes.data?.data || pdfRes.data;
      const scoreFromPdf = toNumberOrNull(
        block?.credit_score ?? block?.cibil_score ?? block?.score
      );
      if (scoreFromPdf != null) finalScore = scoreFromPdf;
      mergedRaw = { ...mergedRaw, cibil_credit_report_pdf: block || pdfRes.data };
      await CibilPrecheckSession.updateOne(
        { _id: session._id },
        { $set: { experianPdfLink: providerPdfLink } }
      );
    } else {
      console.error(
        "commit: CIBIL credit PDF failed",
        pdfRes.error,
        pdfRes.status
      );
    }
  } else if (!providerPdfLink) {
    const pdfRes = await fetchExperianPdfLinkFromSurepass({
      name: session.name,
      mobileStr: session.mobile,
      panStr: session.pan,
      consent: "Y",
    });
    if (pdfRes.ok) {
      providerPdfLink = pdfRes.link;
      const block = pdfRes.data?.data || pdfRes.data;
      const scoreFromPdf = toNumberOrNull(
        block?.credit_score ?? block?.cibil_score ?? block?.score
      );
      if (scoreFromPdf != null) finalScore = scoreFromPdf;
      mergedRaw = {
        ...mergedRaw,
        experian_credit_report_pdf: block || pdfRes.data,
      };
      await CibilPrecheckSession.updateOne(
        { _id: session._id },
        { $set: { experianPdfLink: providerPdfLink } }
      );
    } else {
      console.error("commit: Experian PDF link failed", pdfRes.error, pdfRes.status);
    }
  }

  await saveCibilResult({
    paymentId: razorpay_payment_id,
    customerName: session.name,
    mobile: session.mobile,
    pan: session.pan,
    cibilScore: finalScore,
    rawResponse: mergedRaw,
    aadhaarNumber: aadhaar_number || session.aadhaarNumber,
    aadhaarDocumentUrl: aadhaar_document_url || null,
  });

  let creditReportUrl = null;
  if (providerPdfLink) {
    const storedPath = await downloadExperianPdfToLocalDisk(providerPdfLink);
    if (storedPath) {
      await updateLatestCibilPdfFields(session.mobile, session.pan, {
        experian_pdf_link: providerPdfLink,
        cibil_pdf_report_url: storedPath,
      });
      creditReportUrl = publicFileAbsoluteUrl(req, storedPath);
    } else {
      await updateLatestCibilPdfFields(session.mobile, session.pan, {
        experian_pdf_link: providerPdfLink,
      });
      creditReportUrl = publicFileAbsoluteUrl(req, providerPdfLink);
    }
  }

  await CibilPrecheckSession.updateOne(
    { _id: session._id },
    { $set: { status: "consumed" } }
  );

  await Payment.updateOne(
    { _id: paymentDoc._id },
    {
      $set: {
        status: "paid",
        customer_name: session.name,
        mobile: session.mobile,
        "metadata.pan": session.pan,
        "metadata.cibil_report_kind": reportKind,
        "metadata.cibil_status": "success",
        "metadata.cibil_last_error": null,
        "metadata.cibil_last_attempt_at": new Date(),
      },
    }
  );

  return {
    ok: true,
    report_kind: reportKind,
    score: finalScore,
    report_number: reportNumber,
    report_date: reportDate,
    report_time: reportTime,
    raw: mergedRaw,
    credit_report_link: creditReportUrl,
  };
}

/* =========================
   Step 0: Pre-check (Surepass CIBIL + PDF) — must succeed before payment
========================= */
router.post("/cibil-precheck", async (req, res) => {
  try {
    const {
      name,
      mobile,
      pan,
      aadhaar,
      aadhaar_number,
      consent = "Y",
    } = req.body;

    const reportKind = normalizeReportKind(req.body);
    const gender =
      reportKind === "cibil_credit_report"
        ? normalizeGenderInput(req.body.gender)
        : null;

    if (!name || !mobile || !pan) {
      return res.status(400).json({
        ok: false,
        error: "name, mobile, and pan are required",
      });
    }

    if (reportKind === "cibil_credit_report" && !gender) {
      return res.status(400).json({
        ok: false,
        error:
          "For CIBIL Credit Report PDF, gender is required (male, female, or other).",
      });
    }

    const aadhaar12 = normalizeAadhaar12(aadhaar ?? aadhaar_number);
    if (!aadhaar12) {
      return res.status(400).json({
        ok: false,
        error: "Valid 12-digit Aadhaar number is required.",
      });
    }

    const mobileStr = String(mobile).replace(/\D/g, "").slice(-10);
    const panStr = String(pan).toUpperCase();

    if (!/^\d{10}$/.test(mobileStr)) {
      return res
        .status(400)
        .json({ ok: false, error: "mobile must be 10 digits" });
    }

    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(panStr)) {
      return res.status(400).json({
        ok: false,
        error: "PAN format invalid (ABCDE1234F)",
      });
    }

    let surepassResult;
    try {
      surepassResult = await callSurepassCibilWithRetry({
        name: name.trim(),
        mobile: mobileStr,
        pan: panStr,
      });
    } catch (spErr) {
      const pStatus =
        spErr?.providerStatus ??
        spErr?.response?.status ??
        null;
      const rawMsg = String(spErr?.message || "");
      console.error(
        "cibil-precheck Surepass JSON:",
        pStatus,
        rawMsg,
        spErr?.response?.data || spErr?.providerData || ""
      );

      const transient =
        isRetryableNetworkError(spErr) ||
        /ECONNRESET|ETIMEDOUT|socket hang up/i.test(rawMsg);
      const publicError = transient
        ? "The CIBIL service connection dropped. Please try again in a few seconds."
        : rawMsg ||
          "CIBIL provider could not verify these details. Check name, mobile, and PAN.";

      return res.status(502).json({
        ok: false,
        cibil_status: "failed",
        stage: "cibil_json",
        provider_status: pStatus,
        error: publicError,
        retry_suggested: transient,
      });
    }

    /*
     * Do NOT call the Experian PDF API here. Surepass often rejects a second
     * immediate call (same PAN) after the JSON report call → 502 in production.
     * PDF link is obtained once after successful payment in commitCibilFromPrecheckSession.
     */

    const precheckId = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + PRECHECK_TTL_MS);

    const amountInfo = getAmountsForReportKind(reportKind);

    await CibilPrecheckSession.create({
      precheckId,
      name: name.trim(),
      mobile: mobileStr,
      pan: panStr,
      aadhaarNumber: aadhaar12,
      reportKind,
      gender: reportKind === "cibil_credit_report" ? gender : undefined,
      cibilScore: surepassResult.cibilScore,
      reportNumber: surepassResult.reportNumber,
      reportDate: surepassResult.reportDate,
      reportTime: surepassResult.reportTime,
      providerRaw: surepassResult.providerRaw,
      experianPdfLink: null,
      status: "ready",
      expiresAt,
    });

    return res.json({
      ok: true,
      precheck_id: precheckId,
      report_kind: reportKind,
      amount_in_inr: amountInfo.inr,
      amount_in_paise: amountInfo.paise,
      expires_in_seconds: Math.floor(PRECHECK_TTL_MS / 1000),
      message: "Details verified. Proceed to payment to view your score and report.",
    });
  } catch (err) {
    console.error("cibil-precheck error:", err?.message, err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Pre-check failed" });
  }
});

/* =========================
   Step 1: Create Razorpay order (amount from precheck report kind)
========================= */
router.post("/razorpay/order", async (req, res) => {
  try {
    const { precheck_id: precheckId } = req.body || {};

    if (!precheckId) {
      return res.status(400).json({
        error:
          "Complete CIBIL verification on the form first, then proceed to payment.",
      });
    }

    const session = await CibilPrecheckSession.findOne({
      precheckId: String(precheckId).trim(),
      status: "ready",
    });
    if (!session) {
      return res.status(400).json({
        error:
          "Invalid or expired verification. Please verify your details again before payment.",
      });
    }
    if (session.expiresAt < new Date()) {
      return res.status(400).json({
        error: "Verification expired. Please verify your details again.",
      });
    }

    const { paise, inr } = getAmountsForReportKind(
      session.reportKind || "experian"
    );

    const razor = getRazorpayInstance();

    const order = await razor.orders.create({
      amount: paise,
      currency: "INR",
      receipt: `cibil_${Date.now()}`,
    });
    await upsertPaymentOrder(order, precheckId, {
      reportKind: session.reportKind || "experian",
    });

    res.json({
      id: order.id,
      amount: order.amount,
      amount_in_inr: inr,
      report_kind: session.reportKind || "experian",
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Razorpay order error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   Step 2: Verify payment + Aadhaar file (multipart) + CIBIL from precheck
========================= */
function unlinkUpload(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn("unlinkUpload:", e?.message);
  }
}

router.post(
  "/razorpay/verify-cibil",
  (req, res, next) => {
    aadhaarUploadMiddleware.single("aadhaar_document")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            ok: false,
            error: "Aadhaar file must be 5MB or less.",
          });
        }
        return res.status(400).json({
          ok: false,
          error: err.message || "Aadhaar file upload failed.",
        });
      }
      next();
    });
  },
  async (req, res) => {
    let uploadedPath = null;
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        precheck_id,
        name,
        mobile,
        pan,
        aadhaar,
        aadhaar_number: aadhaarNumberField,
        report_kind: reportKindBody,
        reportKind: reportKindAlt,
      } = req.body;
      const clientReportKind = String(
        reportKindBody || reportKindAlt || ""
      ).trim();

      if (req.file) uploadedPath = req.file.path;

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        unlinkUpload(uploadedPath);
        return res
          .status(400)
          .json({ ok: false, error: "Missing Razorpay verification fields" });
      }

      if (!precheck_id) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error:
            "Missing precheck_id. Verify your CIBIL details on the form before payment.",
        });
      }

      if (!name || !mobile || !pan) {
        unlinkUpload(uploadedPath);
        return res
          .status(400)
          .json({ ok: false, error: "name, mobile, and pan are required" });
      }

      const aadhaar12 = normalizeAadhaar12(aadhaar ?? aadhaarNumberField);
      if (!aadhaar12) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error: "Valid 12-digit Aadhaar number is required.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "Aadhaar document (PDF, PNG, or JPG) is required.",
        });
      }

      const mobileStr = String(mobile).replace(/\D/g, "").slice(-10);
      const panStr = String(pan).toUpperCase();

      if (!/^\d{10}$/.test(mobileStr)) {
        unlinkUpload(uploadedPath);
        return res
          .status(400)
          .json({ ok: false, error: "mobile must be 10 digits" });
      }

      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(panStr)) {
        unlinkUpload(uploadedPath);
        return res
          .status(400)
          .json({ ok: false, error: "PAN format invalid (ABCDE1234F)" });
      }

      const signBody = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(signBody)
        .digest("hex");

      if (expectedSignature !== razorpay_signature) {
        unlinkUpload(uploadedPath);
        return res
          .status(400)
          .json({ ok: false, error: "Invalid Razorpay signature" });
      }

      const payment = await Payment.findOne({ razorpay_order_id });
      if (!payment) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error: "Payment order not found. Create a new order and try again.",
        });
      }

      const orderPrecheck = payment.metadata?.precheck_id;
      if (!orderPrecheck || String(orderPrecheck) !== String(precheck_id).trim()) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error:
            "This payment does not match your verification. Go back, verify your details, and create a new payment.",
        });
      }

      const session = await CibilPrecheckSession.findOne({
        precheckId: String(precheck_id).trim(),
        status: "ready",
      });

      if (!session) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error: "Verification session invalid, expired, or already used.",
        });
      }

      if (session.expiresAt < new Date()) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error: "Verification expired. Please verify your details again.",
        });
      }

      if (session.aadhaarNumber && session.aadhaarNumber !== aadhaar12) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error: "Aadhaar number does not match pre-payment verification.",
        });
      }

      if (session.mobile !== mobileStr || session.pan !== panStr) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error: "Name, mobile, or PAN do not match the pre-payment verification.",
        });
      }

      if (normalizePersonName(session.name) !== normalizePersonName(name)) {
        unlinkUpload(uploadedPath);
        return res.status(400).json({
          ok: false,
          error: "Name does not match the pre-payment verification.",
        });
      }

      const aadhaarDocRel =
        "/" +
        path
          .join("uploads", "cibil-aadhaar", path.basename(req.file.path))
          .replace(/\\/g, "/");

      const productKind = resolveProductReportKind({
        fromSession: session.reportKind,
        fromPaymentMetadata: payment.metadata?.cibil_report_kind,
        fromClient: clientReportKind,
      });
      const paidInr = getAmountsForReportKind(productKind).inr;

      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            purpose: "cibil_check",
            amount: paidInr,
            currency: "INR",
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            "metadata.cibil_report_kind": productKind,
          },
        }
      );

      const out = await commitCibilFromPrecheckSession(
        req,
        payment,
        {
          razorpay_payment_id,
          aadhaar_number: aadhaar12,
          aadhaar_document_url: aadhaarDocRel,
          client_report_kind: clientReportKind,
        },
        session
      );

      return res.json(out);
    } catch (err) {
      unlinkUpload(req.file?.path);
      const ax = err && err.isAxiosError ? err : null;
      const status =
        ax?.response?.status && ax.response.status >= 400 && ax.response.status < 600
          ? ax.response.status
          : 500;

      console.error("verify-cibil fatal:", err?.name, err?.message, err?.stack);

      const expose =
        process.env.NODE_ENV === "development" ||
        String(process.env.EXPOSE_CIBIL_ERRORS || "").trim() === "1";

      return res.status(status).json({
        ok: false,
        source: "server",
        error: "Failed to verify payment or fetch CIBIL",
        ...(expose && { details: String(err?.message || err) }),
      });
    }
  }
);

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

    const mobileStr = String(mobile).replace(/\D/g, "").slice(-10);
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

    const panMasked = maskPan(panStr);

    const latest = await CibilCheck.findOne({
      mobile: mobileStr,
      $or: [{ pan: panStr }, { pan_masked: panMasked }],
    }).sort({ checked_at: -1 });

    if (latest?.cibil_pdf_report_url) {
      return res.json({
        ok: true,
        credit_report_link: publicFileAbsoluteUrl(
          req,
          latest.cibil_pdf_report_url
        ),
        cached: true,
      });
    }

    let providerLink = latest?.experian_pdf_link || null;

    if (!providerLink) {
      let spRes;
      try {
        spRes = await axios.post(
          SUREPASS_PDF_ENDPOINT,
          { name, consent: consent || "Y", mobile: mobileStr, pan: panStr },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUREPASS_TOKEN}`,
            },
            timeout: 45000,
            validateStatus: () => true,
          }
        );
      } catch {
        spRes = await axios.post(
          SUREPASS_PDF_ENDPOINT,
          { name, consent: consent || "Y", mobile: mobileStr, pan: panStr },
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
        const msg =
          spRes.data?.message ||
          spRes.data?.error ||
          "Surepass PDF API failed";
        return res.status(502).json({
          ok: false,
          error: msg,
          provider_status: spRes.status,
        });
      }

      providerLink =
        spRes.data?.data?.credit_report_link ||
        spRes.data?.data?.report_url ||
        spRes.data?.credit_report_link;

      if (!providerLink) {
        console.error(
          "experian-pdf: no link in Surepass body",
          JSON.stringify(spRes.data)?.slice(0, 500)
        );
        return res.status(502).json({
          ok: false,
          error:
            spRes.data?.message ||
            "No PDF link in provider response. Try again later.",
        });
      }

      await updateLatestCibilPdfFields(mobileStr, panStr, {
        experian_pdf_link: providerLink,
      });
    }

    const storedPath = await downloadExperianPdfToLocalDisk(providerLink);
    if (storedPath) {
      await updateLatestCibilPdfFields(mobileStr, panStr, {
        experian_pdf_link: providerLink,
        cibil_pdf_report_url: storedPath,
      });
      return res.json({
        ok: true,
        credit_report_link: publicFileAbsoluteUrl(req, storedPath),
        cached: false,
      });
    }

    return res.json({
      ok: true,
      credit_report_link: publicFileAbsoluteUrl(req, providerLink),
      cached: false,
      upload_note: "local_copy_unavailable",
    });
  } catch (err) {
    console.error("experian-pdf error:", err?.response?.data || err.message);
    res.status(500).json({ ok: false, error: "Failed to fetch Experian PDF" });
  }
});

/* POST /payments/cibil-credit-pdf — CIBIL Credit Report PDF (bureau) – same as Surepass product after payment */
router.post("/cibil-credit-pdf", async (req, res) => {
  try {
    const { name, mobile, pan, gender = "male", consent = "Y" } = req.body;

    if (!name || !mobile || !pan) {
      return res
        .status(400)
        .json({ ok: false, error: "name, mobile, and pan are required" });
    }

    const g = normalizeGenderInput(gender) || "male";
    const mobileStr = String(mobile).replace(/\D/g, "").slice(-10);
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

    const panMasked = maskPan(panStr);
    const latest = await CibilCheck.findOne({
      mobile: mobileStr,
      $or: [{ pan: panStr }, { pan_masked: panMasked }],
    }).sort({ checked_at: -1 });

    if (latest?.cibil_pdf_report_url) {
      return res.json({
        ok: true,
        report_kind: "cibil_credit_report",
        credit_report_link: publicFileAbsoluteUrl(
          req,
          latest.cibil_pdf_report_url
        ),
        cached: true,
      });
    }

    const pdfRes = await fetchCibilCreditReportPdfFromSurepass({
      name,
      mobileStr,
      panStr,
      gender: g,
      consent: consent || "Y",
    });

    if (!pdfRes.ok) {
      return res.status(502).json({
        ok: false,
        error: pdfRes.error,
        provider_status: pdfRes.status,
      });
    }

    const providerLink = pdfRes.link;
    await updateLatestCibilPdfFields(mobileStr, panStr, {
      experian_pdf_link: providerLink,
    });

    const storedPath = await downloadExperianPdfToLocalDisk(providerLink);
    if (storedPath) {
      await updateLatestCibilPdfFields(mobileStr, panStr, {
        experian_pdf_link: providerLink,
        cibil_pdf_report_url: storedPath,
      });
      return res.json({
        ok: true,
        report_kind: "cibil_credit_report",
        credit_report_link: publicFileAbsoluteUrl(req, storedPath),
        cached: false,
      });
    }

    return res.json({
      ok: true,
      report_kind: "cibil_credit_report",
      credit_report_link: publicFileAbsoluteUrl(req, providerLink),
      cached: false,
      upload_note: "local_copy_unavailable",
    });
  } catch (err) {
    console.error("cibil-credit-pdf error:", err?.response?.data || err.message);
    res.status(500).json({
      ok: false,
      error: "Failed to fetch CIBIL Credit Report PDF",
    });
  }
});

export default router;