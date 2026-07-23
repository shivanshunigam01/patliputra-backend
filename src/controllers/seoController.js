import SeoLandingPage from "../models/SeoLandingPage.js";
import { BIHAR_DISTRICTS, getDistrictBySlug } from "../data/biharDistricts.js";
import { SEO_CATEGORIES, SEO_CATEGORY_SLUGS, getSeoCategory } from "../data/seoCategories.js";
import { SEO_FAQS } from "../data/seoFaqs.js";
import { ok, fail } from "../utils/apiResponse.js";

const SITE_URL = process.env.PUBLIC_SITE_URL || "https://patliputraautos.com";

function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** GET /seo/districts */
export async function listDistricts(req, res) {
  return ok(res, BIHAR_DISTRICTS);
}

/** GET /seo/categories */
export async function listCategories(req, res) {
  return ok(res, Object.values(SEO_CATEGORIES));
}

/** GET /seo/keywords */
export async function getKeywordMap(req, res) {
  const map = Object.fromEntries(
    Object.values(SEO_CATEGORIES).map((c) => [
      c.slug,
      {
        primary: c.primaryKeywords,
        subcategories: c.subcategories,
        districtPattern: c.primaryKeywords.map((k) => `${k.split(" ")[0]} in {district}`),
      },
    ])
  );
  return ok(res, map);
}

/** GET /seo/faqs/:category */
export async function getFaqsByCategory(req, res) {
  const category = req.params.category;
  if (!SEO_CATEGORY_SLUGS.includes(category)) {
    return fail(res, "NOT_FOUND", "Unknown SEO category", null, 404);
  }
  return ok(res, SEO_FAQS[category] || []);
}

/** GET /seo/pages — list active landing pages (optional filters) */
export async function listLandingPages(req, res) {
  const filter = { isActive: true };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.district) filter.districtSlug = req.query.district;

  const pages = await SeoLandingPage.find(filter)
    .select("category districtSlug districtName path title metaDescription keywords priority updated_at")
    .sort({ category: 1, districtName: 1 })
    .lean();

  return ok(res, pages, { count: pages.length });
}

/** GET /seo/pages/:category/:district */
export async function getLandingPage(req, res) {
  const { category, district } = req.params;

  if (!SEO_CATEGORY_SLUGS.includes(category)) {
    return fail(res, "NOT_FOUND", "Unknown SEO category", null, 404);
  }
  if (!getDistrictBySlug(district)) {
    return fail(res, "NOT_FOUND", "Unknown district", null, 404);
  }

  let page = await SeoLandingPage.findOne({
    category,
    districtSlug: district,
    isActive: true,
  }).lean();

  // Fallback: generate on the fly if not seeded yet
  if (!page) {
    page = buildFallbackPage(category, district);
  }

  const cat = getSeoCategory(category);
  const relatedDistricts = BIHAR_DISTRICTS.filter((d) => d.slug !== district)
    .slice(0, 8)
    .map((d) => ({
      slug: d.slug,
      name: d.name,
      nameHi: d.nameHi,
      path: `/${category}/${d.slug}`,
    }));

  return ok(res, {
    ...page,
    categoryMeta: {
      slug: cat.slug,
      name: cat.name,
      nameHi: cat.nameHi,
      hubPath: cat.hubPath,
      tagline: cat.tagline,
      subcategories: cat.subcategories,
    },
    relatedDistricts,
    siteUrl: SITE_URL,
  });
}

/** GET /seo/sitemap.xml */
export async function getSitemapXml(req, res) {
  const staticPaths = [
    "/",
    "/jcb",
    "/ashok-leyland",
    "/switch-ev",
    "/used-vehicles",
    "/finance",
    "/emi-calculator",
    "/loan",
    "/insurance",
    "/rto",
    "/government-schemes",
    "/spare-parts",
    "/service",
    "/blogs",
    "/faq",
    "/about",
    "/contact",
    "/dealer-locator",
    "/offers",
    "/parts-lubricants",
    "/service-warranty",
    "/gallery",
    "/careers",
    "/compare",
    "/product-finder",
    "/blogs/jcb-se-mahine-mein-kitni-earning",
    "/blogs/bihar-mein-contractor-business-kaise-shuru-karein",
    "/blogs/road-contractor-ke-liye-best-jcb",
    "/blogs/truck-business-kaise-shuru-karein-bihar",
    "/blogs/sand-transport-ke-liye-kaunsa-tipper",
    "/blogs/electric-bus-profitable-hai-bihar",
    "/blogs/certified-used-jcb-buying-guide",
    "/blogs/jcb-loan-bina-income-proof",
    "/blogs/machine-maintenance-checklist-bihar",
    "/blogs/cement-transport-business-bihar",
  ];

  // subcategory hubs
  for (const cat of Object.values(SEO_CATEGORIES)) {
    for (const sub of cat.subcategories) {
      staticPaths.push(`/${cat.slug}/${sub.slug}`);
    }
  }

  const dbPages = await SeoLandingPage.find({ isActive: true }).select("path updated_at priority").lean();

  // Ensure all 152 district URLs exist even before seed
  const districtUrls = [];
  for (const cat of SEO_CATEGORY_SLUGS) {
    for (const d of BIHAR_DISTRICTS) {
      districtUrls.push({
        path: `/${cat}/${d.slug}`,
        updated_at: null,
        priority: d.slug === "patna" ? 0.9 : 0.7,
      });
    }
  }

  const byPath = new Map();
  for (const p of districtUrls) byPath.set(p.path, p);
  for (const p of dbPages) byPath.set(p.path, p);

  const now = new Date().toISOString();
  const urls = [
    ...staticPaths.map((path) => ({
      loc: `${SITE_URL}${path}`,
      lastmod: now,
      changefreq: "weekly",
      priority: path === "/" ? "1.0" : "0.8",
    })),
    ...Array.from(byPath.values()).map((p) => ({
      loc: `${SITE_URL}${p.path}`,
      lastmod: p.updated_at ? new Date(p.updated_at).toISOString() : now,
      changefreq: "weekly",
      priority: String(p.priority ?? 0.7),
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  res.set("Content-Type", "application/xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  return res.send(xml);
}

/** GET /seo/architecture — layer map for admin/docs */
export async function getArchitecture(req, res) {
  return ok(res, {
    layers: [
      { path: "/", name: "Home" },
      {
        path: "/jcb",
        name: "JCB",
        children: SEO_CATEGORIES.jcb.subcategories.map((s) => ({
          path: `/jcb/${s.slug}`,
          name: s.name,
        })),
      },
      {
        path: "/ashok-leyland",
        name: "Ashok Leyland",
        children: SEO_CATEGORIES["ashok-leyland"].subcategories.map((s) => ({
          path: `/ashok-leyland/${s.slug}`,
          name: s.name,
        })),
      },
      {
        path: "/switch-ev",
        name: "Switch Mobility",
        children: SEO_CATEGORIES.switch.subcategories.map((s) => ({
          path: `/switch/${s.slug}`,
          name: s.name,
        })),
      },
      { path: "/used-vehicles", name: "Used Machines" },
      { path: "/finance", name: "Finance" },
      { path: "/emi-calculator", name: "EMI Calculator" },
      { path: "/loan", name: "Loan" },
      { path: "/insurance", name: "Insurance" },
      { path: "/rto", name: "RTO" },
      { path: "/government-schemes", name: "Government Schemes" },
      { path: "/spare-parts", name: "Spare Parts" },
      { path: "/service", name: "Service" },
      { path: "/blogs", name: "Blogs" },
      { path: "/faq", name: "FAQ" },
      {
        path: "/bihar",
        name: "Bihar District Pages",
        note: "38 districts × 4 categories = 152 pages",
        pattern: "/{category}/{district}",
      },
    ],
    districtPageCount: BIHAR_DISTRICTS.length * SEO_CATEGORY_SLUGS.length,
  });
}

function buildFallbackPage(category, districtSlug) {
  const cat = getSeoCategory(category);
  const district = getDistrictBySlug(districtSlug);
  const faqs = (SEO_FAQS[category] || []).map((f) => ({
    question: f.q,
    answer: f.a.replace(/Bihar/g, district.name).replace(/बिहार/g, district.nameHi),
  }));

  const keywordBase = cat.primaryKeywords[0] || cat.name;

  return {
    category,
    districtSlug: district.slug,
    districtName: district.name,
    path: `/${category}/${district.slug}`,
    title: `${cat.name} in ${district.name}, Bihar | Dealer, Price & EMI | Patliputra`,
    titleHi: `${district.nameHi} mein ${cat.nameHi} – Price, EMI aur Service`,
    metaDescription: `${cat.name} dealer in ${district.name}, Bihar. Price, EMI finance, genuine parts aur service support. ${keywordBase}. Free quotation ke liye call karein.`,
    metaDescriptionHi: `${district.nameHi} mein ${cat.nameHi} ki price, EMI finance aur service. Patliputra authorized dealer – abhi enquiry karein.`,
    h1: `${cat.name} in ${district.name}`,
    h1Hi: `${district.nameHi} mein ${cat.nameHi}`,
    introEn: `Looking for ${cat.name} in ${district.name}? Patliputra is Bihar's trusted partner for ${cat.tagline.toLowerCase()}, easy finance, and after-sales service.`,
    introHi: `${district.nameHi} mein ${cat.nameHi} chahiye? Patliputra se price, EMI, demo aur service support milta hai.`,
    bodyEn: `${district.name} contractors and business owners choose Patliputra for genuine ${cat.name} solutions, transparent pricing, and local support across Bihar.`,
    bodyHi: `${district.nameHi} ke contractors aur businessmen Patliputra se genuine ${cat.nameHi}, clear pricing aur local support lete hain.`,
    keywords: [
      `${cat.name} ${district.name}`,
      `${cat.name} in ${district.name}`,
      `${cat.name} dealer ${district.name}`,
      `${cat.name} price ${district.name}`,
      ...cat.primaryKeywords.slice(0, 5),
    ],
    faqs,
    ctaText: `${district.nameHi} se abhi call karein`,
    isActive: true,
    priority: district.slug === "patna" ? 0.9 : 0.7,
  };
}
