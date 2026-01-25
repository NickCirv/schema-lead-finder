/**
 * Schema-Missing Business Finder - API Server
 *
 * Endpoints:
 * POST /api/find-leads - Start a new lead generation job
 * GET /api/job/:jobId - Check job status
 * GET /api/job/:jobId/download - Download results
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

/**
 * POST /api/find-leads
 * Start a new lead generation job
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
 * Background job processor
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
            console.log(`📧 Would send results to ${email}`);
            // await sendEmailNotification(email, jobId, job.results);
        }

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
 * Landing page - CirvGreen branded
 */
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Schema Lead Finder | CirvGreen Digital</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                * { box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 900px;
                    margin: 0 auto;
                    padding: 40px 20px;
                    background: #f8fafc;
                    color: #1e293b;
                    line-height: 1.6;
                }
                .header {
                    text-align: center;
                    margin-bottom: 40px;
                }
                .logo {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 14px;
                    color: #4CAF50;
                    font-weight: 600;
                    margin-bottom: 10px;
                }
                h1 {
                    color: #0f172a;
                    font-size: 2.5rem;
                    margin: 0 0 15px 0;
                }
                .tagline {
                    color: #64748b;
                    font-size: 1.2rem;
                }
                .hero-stat {
                    display: inline-block;
                    background: linear-gradient(135deg, #4CAF50 0%, #2271b1 100%);
                    color: white;
                    padding: 20px 40px;
                    border-radius: 12px;
                    margin: 30px 0;
                }
                .hero-stat strong { font-size: 2rem; }
                .card {
                    background: white;
                    border-radius: 12px;
                    padding: 25px;
                    margin: 20px 0;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    border: 1px solid #e2e8f0;
                }
                .card h3 {
                    color: #4CAF50;
                    margin-top: 0;
                    font-size: 1.1rem;
                }
                pre {
                    background: #0f172a;
                    color: #e2e8f0;
                    padding: 20px;
                    border-radius: 8px;
                    overflow-x: auto;
                    font-size: 13px;
                }
                .pricing {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin: 30px 0;
                }
                .price-card {
                    background: white;
                    border: 2px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 25px;
                    text-align: center;
                }
                .price-card.featured {
                    border-color: #4CAF50;
                    position: relative;
                }
                .price-card.featured::before {
                    content: 'POPULAR';
                    position: absolute;
                    top: -12px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #4CAF50;
                    color: white;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 600;
                }
                .price { font-size: 2rem; font-weight: 700; color: #0f172a; }
                .price span { font-size: 1rem; color: #64748b; }
                .btn {
                    display: inline-block;
                    background: #4CAF50;
                    color: white;
                    padding: 12px 30px;
                    border-radius: 8px;
                    text-decoration: none;
                    font-weight: 600;
                    margin-top: 15px;
                }
                .btn:hover { background: #3d8b40; }
                .footer {
                    text-align: center;
                    margin-top: 50px;
                    padding-top: 30px;
                    border-top: 1px solid #e2e8f0;
                    color: #64748b;
                }
                .footer a { color: #4CAF50; }
                code {
                    background: #f1f5f9;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 13px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">
                    <span>🌿</span> CIRVGREEN DIGITAL
                </div>
                <h1>Schema Lead Finder</h1>
                <p class="tagline">Find businesses missing schema markup.<br>Qualified leads, delivered automatically.</p>
                <div class="hero-stat">
                    <strong>60-80%</strong><br>of local businesses have NO schema
                </div>
            </div>

            <div class="card">
                <h3>🚀 How It Works</h3>
                <ol>
                    <li><strong>You specify</strong> a niche + location (e.g., "dentist chicago")</li>
                    <li><strong>We scrape</strong> Google Maps for businesses</li>
                    <li><strong>We audit</strong> each website for schema markup</li>
                    <li><strong>You receive</strong> a CSV of qualified leads with verified issues</li>
                </ol>
            </div>

            <div class="card">
                <h3>📡 API Endpoint</h3>
                <p><code>POST /api/find-leads</code></p>
                <pre>{
  "niche": "dentist",
  "location": "chicago",
  "limit": 100,
  "email": "you@email.com"
}</pre>
                <p style="margin-top:15px;color:#64748b;">
                    Returns a job ID. Poll <code>GET /api/job/:jobId</code> for status.
                    Download results with <code>GET /api/job/:jobId/download/csv</code>
                </p>
            </div>

            <h2 style="text-align:center;margin-top:50px;">Pricing</h2>
            <div class="pricing">
                <div class="price-card">
                    <h4>One-Time</h4>
                    <div class="price">$99</div>
                    <p>200+ leads<br>Single niche/city<br>CSV delivery</p>
                </div>
                <div class="price-card featured">
                    <h4>Monthly</h4>
                    <div class="price">$149<span>/mo</span></div>
                    <p>Weekly refresh<br>Same niche/city<br>Email delivery</p>
                </div>
                <div class="price-card">
                    <h4>Enterprise</h4>
                    <div class="price">$499<span>/mo</span></div>
                    <p>5 niches<br>Weekly refresh<br>Priority support</p>
                </div>
            </div>

            <div style="text-align:center;margin-top:40px;">
                <a href="mailto:nick@cirvgreen.com?subject=Schema Lead Finder Inquiry" class="btn">Get Started</a>
            </div>

            <div class="footer">
                <p>Built by <a href="https://cirvgreen.com">CirvGreen Digital</a></p>
                <p>Also check out <a href="https://wordpress.org/plugins/cirv-box/">Cirv Box</a> - Free Schema Plugin for WordPress</p>
            </div>
        </body>
        </html>
    `);
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Schema-Missing Business Finder API running on http://localhost:${PORT}`);
});

module.exports = app;
