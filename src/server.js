/**
 * Schema-Missing Business Finder - API Server
 *
 * Endpoints:
 * POST /api/find-leads      - Start a new lead generation job (paid)
 * POST /api/find-leads-free  - Start a free sample job (3 leads, limited data)
 * GET  /api/job/:jobId       - Check job status
 * GET  /api/job/:jobId/download - Download results
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { scrapeGoogleMaps, batchAuditSchemas, filterLeads, generateReport } = require('./index');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory job storage (use Redis in production)
const jobs = new Map();

// -------------------------------------------------------------------
// Rate limiting for free tier: max 3 requests per IP per day
// -------------------------------------------------------------------
const freeRateLimits = new Map(); // ip -> { count, resetAt }

function cleanupRateLimits() {
    const now = Date.now();
    for (const [ip, entry] of freeRateLimits) {
        if (now >= entry.resetAt) {
            freeRateLimits.delete(ip);
        }
    }
}

// Cleanup stale entries every hour
setInterval(cleanupRateLimits, 60 * 60 * 1000);

function checkFreeRateLimit(ip) {
    const now = Date.now();
    const entry = freeRateLimits.get(ip);

    if (!entry || now >= entry.resetAt) {
        // New day or first request
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        freeRateLimits.set(ip, { count: 1, resetAt: midnight.getTime() });
        return { allowed: true, remaining: 2 };
    }

    if (entry.count >= 3) {
        const retryAfterMs = entry.resetAt - now;
        const retryAfterMin = Math.ceil(retryAfterMs / 60000);
        return { allowed: false, remaining: 0, retryAfterMin };
    }

    entry.count += 1;
    return { allowed: true, remaining: 3 - entry.count };
}

/**
 * POST /api/find-leads
 * Start a new lead generation job (paid tier - full data)
 *
 * Body: { niche: string, location: string, limit?: number, email?: string }
 */
app.post('/api/find-leads', async (req, res) => {
    const { niche, location, limit = 100, email } = req.body;

    if (!niche || !location) {
        return res.status(400).json({
            error: 'Missing required fields: niche, location'
        });
    }

    // Generate job ID
    const jobId = crypto.randomUUID();

    // Store job
    jobs.set(jobId, {
        id: jobId,
        status: 'processing',
        tier: 'paid',
        niche,
        location,
        limit,
        email,
        createdAt: new Date().toISOString(),
        progress: 0,
        results: null,
        error: null
    });

    // Return immediately with job ID
    res.json({
        success: true,
        jobId,
        message: 'Job started. Check /api/job/:jobId for status.',
        estimatedTime: `${Math.ceil(limit / 10)} minutes`
    });

    // Process in background
    processJob(jobId, niche, location, limit, email).catch(err => {
        console.error(`Job ${jobId} failed:`, err);
        const job = jobs.get(jobId);
        if (job) {
            job.status = 'failed';
            job.error = err.message;
        }
    });
});

/**
 * POST /api/find-leads-free
 * Start a free sample job (3 leads, stripped contact details)
 *
 * Body: { niche: string, location: string }
 */
app.post('/api/find-leads-free', async (req, res) => {
    const { niche, location } = req.body;

    if (!niche || !location) {
        return res.status(400).json({
            error: 'Missing required fields: niche, location'
        });
    }

    // Rate limit check
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const rateCheck = checkFreeRateLimit(clientIp);

    if (!rateCheck.allowed) {
        return res.status(429).json({
            error: `Free tier limit reached (3 requests per day). Try again in ${rateCheck.retryAfterMin} minutes, or upgrade to a paid plan for unlimited access.`,
            upgrade: true
        });
    }

    // Generate job ID
    const jobId = crypto.randomUUID();

    // Store job — force limit to 3 and mark as free tier
    jobs.set(jobId, {
        id: jobId,
        status: 'processing',
        tier: 'free',
        niche,
        location,
        limit: 20, // fetch more to ensure we get 3 valid leads after filtering
        email: null,
        createdAt: new Date().toISOString(),
        progress: 0,
        results: null,
        error: null
    });

    // Return immediately with job ID
    res.json({
        success: true,
        jobId,
        message: 'Free sample started. Check /api/job/:jobId for status.',
        estimatedTime: '2-3 minutes',
        remaining: rateCheck.remaining
    });

    // Process in background
    processFreeJob(jobId, niche, location).catch(err => {
        console.error(`Free job ${jobId} failed:`, err);
        const job = jobs.get(jobId);
        if (job) {
            job.status = 'failed';
            job.error = err.message;
        }
    });
});

/**
 * Background job processor (paid tier - full data)
 */
async function processJob(jobId, niche, location, limit, email) {
    const job = jobs.get(jobId);

    try {
        // Step 1: Scrape Google Maps
        job.progress = 10;
        job.status = 'scraping';
        const businesses = await scrapeGoogleMaps(niche, location, limit);

        job.progress = 40;
        job.status = 'auditing';

        // Step 2: Audit schemas
        const audited = await batchAuditSchemas(businesses);

        job.progress = 80;
        job.status = 'filtering';

        // Step 3: Filter leads
        const leads = filterLeads(audited);

        job.progress = 90;
        job.status = 'generating_report';

        // Step 4: Generate report
        const files = await generateReport(leads, niche, location);

        // Store results
        job.status = 'completed';
        job.progress = 100;
        job.results = {
            totalBusinesses: businesses.length,
            totalLeads: leads.length,
            conversionRate: Math.round((leads.length / businesses.length) * 100),
            files,
            leads: leads.slice(0, 10) // Preview first 10
        };
        job.completedAt = new Date().toISOString();

        // TODO: Send email notification if email provided
        if (email) {
            console.log(`Would send results to ${email}`);
            // await sendEmailNotification(email, jobId, job.results);
        }

    } catch (error) {
        job.status = 'failed';
        job.error = error.message;
        throw error;
    }
}

/**
 * Background job processor (free tier - limited data)
 */
async function processFreeJob(jobId, niche, location) {
    const job = jobs.get(jobId);

    try {
        // Step 1: Scrape Google Maps (small batch)
        job.progress = 10;
        job.status = 'scraping';
        const businesses = await scrapeGoogleMaps(niche, location, 20);

        job.progress = 40;
        job.status = 'auditing';

        // Step 2: Audit schemas
        const audited = await batchAuditSchemas(businesses);

        job.progress = 80;
        job.status = 'filtering';

        // Step 3: Filter leads
        const allLeads = filterLeads(audited);

        // Take only first 3 leads
        const sampleLeads = allLeads.slice(0, 3);

        // Strip contact details — only keep name, city, missing schema types
        const strippedLeads = sampleLeads.map(lead => ({
            name: lead.name || lead.businessName || 'Unknown',
            city: lead.city || lead.address?.city || '',
            missingSchemaTypes: lead.missingSchemaTypes || lead.missingSchema || []
            // Deliberately omitting: website, phone, email, address, rating, reviews
        }));

        // Store results
        job.status = 'completed';
        job.progress = 100;
        job.results = {
            totalBusinesses: businesses.length,
            totalLeads: strippedLeads.length,
            fullResultsCount: allLeads.length,
            leads: strippedLeads,
            upgrade: true
        };
        job.completedAt = new Date().toISOString();

    } catch (error) {
        job.status = 'failed';
        job.error = error.message;
        throw error;
    }
}

/**
 * GET /api/job/:jobId
 * Check job status
 */
app.get('/api/job/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
        id: job.id,
        status: job.status,
        progress: job.progress,
        tier: job.tier,
        niche: job.niche,
        location: job.location,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        results: job.results,
        error: job.error
    });
});

/**
 * GET /api/job/:jobId/download/:format
 * Download results (csv or json)
 */
app.get('/api/job/:jobId/download/:format', async (req, res) => {
    const { jobId, format } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    if (job.tier === 'free') {
        return res.status(403).json({
            error: 'Downloads are not available on the free tier. Upgrade to a paid plan.',
            upgrade: true
        });
    }

    if (job.status !== 'completed') {
        return res.status(400).json({ error: 'Job not completed yet' });
    }

    const filename = format === 'csv' ? job.results.files.csv : job.results.files.json;
    const filePath = path.join(__dirname, '..', 'output', filename);

    try {
        const content = await fs.readFile(filePath);
        res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(content);
    } catch (error) {
        res.status(500).json({ error: 'File not found' });
    }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * robots.txt
 */
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *\nAllow: /\n\nSitemap: https://schema-lead-finder.onrender.com/sitemap.xml\n`);
});

/**
 * sitemap.xml
 */
app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://schema-lead-finder.onrender.com/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

/**
 * Landing page - serve static file
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'landing.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Schema-Missing Business Finder API running on http://localhost:${PORT}`);
});

module.exports = app;
