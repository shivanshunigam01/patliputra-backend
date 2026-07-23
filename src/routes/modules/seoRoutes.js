import { Router } from "express";
import {
  listDistricts,
  listCategories,
  getKeywordMap,
  getFaqsByCategory,
  listLandingPages,
  getLandingPage,
  getSitemapXml,
  getArchitecture,
} from "../../controllers/seoController.js";

const router = Router();

router.get("/districts", listDistricts);
router.get("/categories", listCategories);
router.get("/keywords", getKeywordMap);
router.get("/faqs/:category", getFaqsByCategory);
router.get("/pages", listLandingPages);
router.get("/pages/:category/:district", getLandingPage);
router.get("/architecture", getArchitecture);
router.get("/sitemap.xml", getSitemapXml);

export default router;
