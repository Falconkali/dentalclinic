# LUMIÈRE DENTAL STUDIO — PREMIUM DESIGN V2
## Independent Design System & Parallel Visual Evolution

### Overview
This directory contains the complete **V2 Premium Design** for Lumière Dental Studio. It lives entirely in parallel with the untouched V11 production baseline, ensuring guaranteed zero-risk evaluation and one-step rollback.

### Directory Structure
```text
lumiere-premium-v2/
├── index.html        # Redesigned editorial public website
├── styles.css        # V2 unified design tokens & responsive public stylesheet
├── script.js         # Editorial motion, GSAP reveals & live booking logic
├── portal.html       # Redesigned light clinical CRM & staff portal
├── portal.css        # Linear-inspired CRM stylesheet & responsive KPI grid
├── portal.js         # CRM state management, live Supabase sync & role-based UX
├── assets/           # Curated editorial photography & branding vectors
└── README.md         # This architectural guide
```

### Design Philosophy
- **Quiet Luxury**: Subtle, understated elegance inspired by Aesop, Kinfolk, and modern European architectural studios.
- **Color Palette**:
  - Warm Ivory (`#F5F3ED`) & Soft White (`#FAF9F6`) canvas surfaces
  - Charcoal (`#242620`) high-contrast editorial typography
  - Warm Stone (`#E8E4DA`) and fine hairline borders (`#E7E5DC`)
  - Natural Muted Olive (`#777F68`) & Terracotta (`#B86C52`) accents
- **Typography**:
  - Display & Headings: *Cormorant Garamond* (Google Fonts)
  - Interface & Body: *Manrope*
  - Data & Reference Metrics: *IBM Plex Mono*

### Backend & API Contracts
V2 uses the exact same backend contracts as V11:
- Central clinic configuration loaded from `../clinic.config.js`
- Authenticated Supabase client and API functions from `../clinic-api.js`
- Zero changes to database migrations, RLS policies, PostgreSQL triggers, or Edge Functions.
