# Schema-Missing Business Finder - MCP Automated PRD

**Created:** 2026-01-23
**Category:** MCP-AUTOMATED / Lead Generation
**Status:** 🔴 NEW - High Priority
**Priority:** CRITICAL - Build This Week

---

## Quick Reference

**What It Is:** Automated pipeline that finds businesses without proper schema markup and delivers qualified leads

**Revenue:** $1,500-4,000/month (15-40 customers at $99/mo)

**Build Time:** 4 hours (one-time)

**Automation Level:** 95% automated

**MCP Tools:** `Apify Google Maps Scraper` + `Schema Audit Tool` + Email delivery

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ AUTOMATED PIPELINE                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 1. INPUT: Customer specifies niche + location                    │
│    Example: "dentist chicago" or "plumber austin"                │
│                                                                  │
│ 2. SCRAPE: Apify Google Maps Scraper                            │
│    → Returns 500-2000 businesses with:                          │
│      • Business name                                             │
│      • Website URL                                               │
│      • Phone number                                              │
│      • Address                                                   │
│      • Rating & reviews                                          │
│                                                                  │
│ 3. AUDIT: Schema Audit Tool (batch processing)                   │
│    → Check each website for schema markup                        │
│    → Flag: Missing, Broken, Incomplete, Good                     │
│                                                                  │
│ 4. FILTER: Keep only leads with schema issues                    │
│    → Typically 60-80% of businesses have NO schema               │
│                                                                  │
│ 5. ENRICH: Add business size indicators                          │
│    → Review count (more reviews = bigger business)               │
│    → Rating (higher rating = better lead quality)                │
│                                                                  │
│ 6. DELIVER: Send to customer                                     │
│    → CSV/Excel with all lead data                                │
│    → Weekly automated refresh option                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Core Build (2 hours)

```bash
# Step 1: Test Apify Google Maps Scraper
# Use call-actor with apify/google-maps-scraper
# Input: { "searchStringsArray": ["dentist chicago"], "maxCrawledPlaces": 100 }

# Step 2: Export results to CSV
# Filter for entries with website URLs

# Step 3: Batch schema audit
# Loop through URLs with Schema Audit Tool API
# Output: URL, has_schema, schema_types, issues

# Step 4: Combine data
# Merge Maps data + Audit results
# Filter for schema issues only
```

### Phase 2: Automation Layer (1 hour)

- Create n8n workflow or cron job
- Input: niche + location from customer dashboard
- Auto-run weekly for subscription customers
- Email delivery with formatted report

### Phase 3: Customer Interface (1 hour)

- Simple order form (Stripe + Typeform)
- Customer enters: niche, location, email
- Automated fulfillment within 24 hours
- Upsell: Weekly refresh subscription

---

## Pricing

| Tier | Price | Deliverable | Target Customer |
|------|-------|-------------|-----------------|
| **One-Time** | $99 | 200+ leads, single niche/city | Freelance SEOs |
| **Monthly** | $149/mo | Weekly refresh, same niche | SEO agencies |
| **Enterprise** | $499/mo | 5 niches, weekly refresh | Large agencies |

---

## Target Market

**Primary Customers:**
- SEO freelancers needing prospecting lists
- Digital marketing agencies
- Web development shops selling SEO add-ons
- Schema implementation consultants (your competition = your customers)

**Pain Points:**
- Manual prospecting is tedious (hours per lead)
- Don't know which businesses need schema help
- Need qualified leads with verified issues
- Want to focus on selling, not prospecting

**Value Proposition:**
"Stop cold calling. Get 200+ pre-qualified leads with verified schema issues delivered to your inbox every week."

---

## Marketing

**Launch Strategy:**

1. **Reddit r/SEO** - Post: "I built a tool that finds businesses without schema markup. First 10 agencies get lifetime access for feedback."

2. **SEO Twitter** - Share anonymized stats: "Analyzed 500 dentists in Chicago. 78% have NO schema markup. That's $X in potential revenue for SEO agencies."

3. **LinkedIn** - Target SEO agency owners with case study: "How I generated 200 qualified leads in 10 minutes"

**First 10 Customers:**
- Offer free trial: 50 leads in their niche
- If they close 1 deal, they'll subscribe forever

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Lead accuracy | >95% | Schema issues verified |
| Delivery time | <24h | From order to inbox |
| Customer retention | >80% | Monthly subscribers |
| Lead-to-close ratio | >5% | Customer feedback |

---

## Technical Requirements

**Apify Actor:** `apify/google-maps-scraper`
- Cost: ~$5 per 1000 places
- Speed: 500 places in ~10 minutes

**Schema Audit Tool API:**
- Your existing tool
- Batch endpoint needed (or loop)

**Delivery:**
- Email (SendGrid/Resend)
- CSV attachment
- Optional: Google Sheets auto-update

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Apify rate limits | Batch requests, respect limits |
| Schema audit slow | Parallel processing, caching |
| Lead quality concerns | Guarantee accuracy, refund policy |
| Competition copies | Speed to market, relationships |

---

## Next Steps

1. [ ] Test Apify Google Maps Scraper with sample query
2. [ ] Build batch schema audit script
3. [ ] Create data merge + filter logic
4. [ ] Set up Stripe payment link
5. [ ] Create order form (Typeform/Tally)
6. [ ] Test full pipeline end-to-end
7. [ ] Launch to r/SEO for first customers

---

**Status:** 🔴 NEW → 🟡 Building → ✅ Launched → 💰 Profitable

**Last Updated:** 2026-01-23
