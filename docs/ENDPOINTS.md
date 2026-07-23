# Endpoints (v1)

Auth
- POST /v1/auth/login
- POST /v1/auth/refresh
- POST /v1/auth/logout

Dashboard (admin)
- GET /v1/dashboard

Banners
- GET /v1/banners/:page (public)
- GET /v1/banners (admin)
- POST /v1/banners (admin)
- PUT /v1/banners/:id (admin)
- DELETE /v1/banners/:id (admin)

Brands
- GET /v1/brands (public)
- GET /v1/brands/:slug (public)
- POST /v1/brands (admin)
- PUT /v1/brands/:id (admin)
- DELETE /v1/brands/:id (admin)

Categories
- GET /v1/categories (public)
- GET /v1/categories/:id (public)
- POST /v1/categories (admin)
- PUT /v1/categories/:id (admin)
- DELETE /v1/categories/:id (admin)

Products
- GET /v1/products (public)
- GET /v1/products/compare?ids=<id1>,<id2> (public)
- GET /v1/products/:slug (public)
- POST /v1/products (admin)
- PUT /v1/products/:id (admin)
- DELETE /v1/products/:id (admin)

New Arrivals
- GET /v1/new-arrivals (public)
- POST /v1/new-arrivals (admin)
- PUT /v1/new-arrivals/:id (admin)
- DELETE /v1/new-arrivals/:id (admin)

Used Vehicles
- GET /v1/used-vehicles (public)
- GET /v1/used-vehicles/:id (public)
- POST /v1/used-vehicles (admin)
- PUT /v1/used-vehicles/:id (admin)
- PATCH /v1/used-vehicles/:id/status (admin)
- DELETE /v1/used-vehicles/:id (admin)

Leads
- POST /v1/leads (public, rate limited)
- GET /v1/leads (admin)
- GET /v1/leads/dashboard (admin)
- GET /v1/leads/:id (admin)
- PUT /v1/leads/:id (admin)
- PATCH /v1/leads/:id/status (admin)
- PATCH /v1/leads/:id/assign (admin)
- POST /v1/leads/:id/notes (admin)

Finance
- POST /v1/finance/apply (public)
- GET /v1/finance/applications (admin)
- GET /v1/finance/applications/:id (admin)
- PATCH /v1/finance/applications/:id/status (admin)

CIBIL (Razorpay + Surepass)
- POST /v1/cibil/create-order (public, rate limited)
- POST /v1/cibil/verify-and-check (public, rate limited)
- GET /v1/cibil (admin)
- GET /v1/cibil/analytics (admin)

Media (Cloudinary)
- POST /v1/media/upload (admin, multipart form-data, field: file)
- POST /v1/media/upload-multiple (admin, multipart form-data, field: files[])
- GET /v1/media (admin)
- DELETE /v1/media/:id (admin)

Settings
- GET /v1/settings (public)
- GET /v1/settings/admin (admin)
- PUT /v1/settings (admin)

Analytics
- POST /v1/analytics/comparison (public)
- GET /v1/analytics/comparisons (admin)

SEO (Month 1 architecture)
- GET /seo/districts (public) — 38 Bihar districts
- GET /seo/categories (public) — JCB, Ashok Leyland, Switch, Used JCB
- GET /seo/keywords (public) — keyword map by category
- GET /seo/faqs/:category (public) — Hinglish FAQs
- GET /seo/pages (public) — list district landing pages
- GET /seo/pages/:category/:district (public) — single hyperlocal page
- GET /seo/architecture (public) — URL layer map
- GET /seo/sitemap.xml (public) — XML sitemap including 152 district URLs

Seed: `npm run seed:seo`

