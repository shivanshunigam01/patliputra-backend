import { Router } from "express";

import authRoutes from "./modules/authRoutes.js";
import bannerRoutes from "./modules/bannerRoutes.js";
import brandRoutes from "./modules/brandRoutes.js";
import categoryRoutes from "./modules/categoryRoutes.js";
import productRoutes from "./modules/productRoutes.js";
import newArrivalRoutes from "./modules/newArrivalRoutes.js";
import usedVehicleRoutes from "./modules/usedVehicleRoutes.js";
import testimonialRoutes from "./modules/testimonialRoutes.js";
import trustRoutes from "./modules/trustRoutes.js";
import emiRoutes from "./modules/emiRoutes.js";
import leadRoutes from "./modules/leadRoutes.js";
import contactRoutes from "./modules/contactRoutes.js";
import financeRoutes from "./modules/financeRoutes.js";
import analyticsRoutes from "./modules/analyticsRoutes.js";
import settingsRoutes from "./modules/settingsRoutes.js";
import mediaRoutes from "./modules/mediaRoutes.js";
import cibilRoutes from "./modules/cibilRoutes.js";
import dashboardRoutes from "./modules/dashboardRoutes.js";
import userRoutes from "../routes/userRoutes.js"
import productMediaRoutes from "./modules/productMediaRoutes.js";
import dealerRoutes from "../routes/dealerRoutes.js"
import offerRoutes from "./offer.routes.js";
import contentPageRoutes from "../routes/contentPage.routes.js";
import paymentPageRoutes from "../routes/payment.routes.js";
import cibilSyncRoutes from "./modules/cibilSync.routes.js";
import careerRoutes from "../routes/careerRoutes.js";
import timelineRoutes from "../routes/timelineRoutes.js";
import serviceKitEnquiryRoutes from "./serviceKitEnquiryRoutes.js";






const router = Router();
router.use("/products", productMediaRoutes);
router.use("/dealers", dealerRoutes);
router.use("/users", userRoutes);
router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/offers", offerRoutes);
router.use("/content-pages", contentPageRoutes);
router.use("/payments", paymentPageRoutes);
router.use("/cibil", cibilSyncRoutes);
router.use("/finance", financeRoutes);
router.use('/careers', careerRoutes);




router.use("/banners", bannerRoutes);
router.use("/brands", brandRoutes);
router.use("/categories", categoryRoutes);
router.use("/products", productRoutes);
router.use("/new-arrivals", newArrivalRoutes);
router.use("/used-vehicles", usedVehicleRoutes);
router.use("/testimonials", testimonialRoutes);
router.use("/trust-pillars", trustRoutes);
router.use("/emi-settings", emiRoutes);
router.use("/leads", leadRoutes);
router.use("/contact", contactRoutes);
router.use("/finance", financeRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/settings", settingsRoutes);
router.use("/media", mediaRoutes);
router.use("/cibil", cibilRoutes);
router.use("/timeline", timelineRoutes);
router.use("/service-kit-enquiries", serviceKitEnquiryRoutes);


export default router;
