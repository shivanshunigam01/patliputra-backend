import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

import { connectDB } from "../config/db.js";
import SeoLandingPage from "../models/SeoLandingPage.js";
import { BIHAR_DISTRICTS } from "../data/biharDistricts.js";
import { SEO_CATEGORIES, SEO_CATEGORY_SLUGS } from "../data/seoCategories.js";
import { SEO_FAQS } from "../data/seoFaqs.js";

function buildPage(categorySlug, district) {
  const cat = SEO_CATEGORIES[categorySlug];
  const faqs = (SEO_FAQS[categorySlug] || []).map((f) => ({
    question: f.q,
    answer: f.a,
  }));

  return {
    category: categorySlug,
    districtSlug: district.slug,
    districtName: district.name,
    path: `/${categorySlug}/${district.slug}`,
    title: `${cat.name} in ${district.name}, Bihar | Dealer, Price & EMI | Patliputra`,
    titleHi: `${district.nameHi} mein ${cat.nameHi} – Price, EMI aur Service`,
    metaDescription: `${cat.name} dealer in ${district.name}, Bihar. On-road price, EMI finance, genuine parts aur fast service. Free quotation ke liye Patliputra ko call karein.`,
    metaDescriptionHi: `${district.nameHi} mein ${cat.nameHi} ki price, EMI finance, spare parts aur service. Authorized Patliputra dealer – abhi enquiry karein.`,
    h1: `${cat.name} in ${district.name}`,
    h1Hi: `${district.nameHi} mein ${cat.nameHi}`,
    introEn: `Patliputra serves ${district.name} (${district.hq}) with genuine ${cat.name} ${cat.tagline.toLowerCase()}, transparent pricing, and easy finance options for contractors and fleet owners.`,
    introHi: `Patliputra ${district.nameHi} (${district.hq}) mein genuine ${cat.nameHi}, clear pricing aur easy EMI finance deta hai – contractors aur businessmen ke liye.`,
    bodyEn: `Whether you need new equipment, finance support, or after-sales service in ${district.name}, our team helps with model selection, EMI planning, documentation, and delivery. We also support nearby towns around ${district.hq}.`,
    bodyHi: `${district.nameHi} mein naya machine, finance ya service chahiye to hum model selection, EMI planning, documents aur delivery mein help karte hain. ${district.hq} ke aas-paas ke areas mein bhi support milta hai.`,
    keywords: [
      `${cat.name} ${district.name}`,
      `${cat.name} in ${district.name}`,
      `${cat.name} dealer ${district.name}`,
      `${cat.name} price Bihar`,
      `${cat.name} EMI ${district.name}`,
      ...cat.primaryKeywords.slice(0, 6),
    ],
    faqs,
    ctaText: `${district.nameHi} se abhi call karein`,
    isActive: true,
    priority: ["patna", "muzaffarpur", "gaya", "bhagalpur", "darbhanga"].includes(district.slug)
      ? 0.9
      : 0.7,
  };
}

async function seed() {
  await connectDB();

  const docs = [];
  for (const category of SEO_CATEGORY_SLUGS) {
    for (const district of BIHAR_DISTRICTS) {
      docs.push(buildPage(category, district));
    }
  }

  let upserted = 0;
  for (const doc of docs) {
    await SeoLandingPage.findOneAndUpdate(
      { category: doc.category, districtSlug: doc.districtSlug },
      { $set: doc },
      { upsert: true, new: true }
    );
    upserted += 1;
  }

  console.log(`✅ SEO landing pages seeded: ${upserted} (38 districts × 4 categories)`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(async (err) => {
  console.error("❌ SEO seed failed:", err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
