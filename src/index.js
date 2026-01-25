#!/usr/bin/env node
/**
 * Schema-Missing Business Finder
 *
 * Automated pipeline that:
 * 1. Scrapes Google Maps for businesses in a niche/location
 * 2. Audits each website for schema markup
 * 3. Filters for businesses with missing/broken schema
 * 4. Outputs qualified leads
 *
 * Usage: node index.js "dentist" "chicago" --limit 100
 */

const { ApifyClient } = require('apify-client');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const APIFY_TOKEN = process.env.APIFY_TOKEN || 'apify_api_ciMAoXgZY0bXiN9OBgPYctybme9TjY2Jzx1E';
const SCHEMA_AUDIT_API = process.env.SCHEMA_AUDIT_API || 'https://schema-audit-tool.onrender.com/api/audit';

// Initialize Apify client
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

/**
 * Step 1: Scrape Google Maps for businesses
 */
async function scrapeGoogleMaps(niche, location, limit = 100) {
    console.log(`🔍 Scraping Google Maps for "${niche}" in "${location}"...`);

    const input = {
        searchStringsArray: [`${niche} ${location}`],
        maxCrawledPlacesPerSearch: limit,
        language: 'en',
        deeperCityScrape: false,
        skipClosedPlaces: true,
    };

    try {
        // Run the Google Maps Scraper actor
        const run = await apifyClient.actor('compass/crawler-google-places').call(input);

        // Fetch results from dataset
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

        console.log(`✅ Found ${items.length} businesses`);

        // Extract relevant fields
        return items.map(item => ({
            name: item.title || item.name,
            website: item.website,
            phone: item.phone,
            address: item.address,
            rating: item.totalScore,
            reviews: item.reviewsCount,
            category: item.categoryName,
            placeId: item.placeId,
            url: item.url
        })).filter(item => item.website); // Only keep businesses with websites

    } catch (error) {
        console.error('❌ Google Maps scrape failed:', error.message);
        throw error;
    }
}

/**
 * Step 2: Audit website for schema markup
 */
async function auditSchema(url) {
    try {
        const response = await axios.post(SCHEMA_AUDIT_API, { url }, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
        });

        return {
            url,
            hasSchema: response.data.schemas?.length > 0,
            schemaTypes: response.data.schemas?.map(s => s['@type']) || [],
            issues: response.data.issues || [],
            score: response.data.score || 0
        };
    } catch (error) {
        // If audit fails, assume no schema (conservative approach)
        return {
            url,
            hasSchema: false,
            schemaTypes: [],
            issues: ['Could not audit - site may be blocking or down'],
            score: 0
        };
    }
}

/**
 * Step 3: Batch audit all websites
 */
async function batchAuditSchemas(businesses, concurrency = 5) {
    console.log(`\n🔬 Auditing ${businesses.length} websites for schema markup...`);

    const results = [];
    const batches = [];

    // Create batches
    for (let i = 0; i < businesses.length; i += concurrency) {
        batches.push(businesses.slice(i, i + concurrency));
    }

    let processed = 0;

    for (const batch of batches) {
        const batchResults = await Promise.all(
            batch.map(async (business) => {
                const audit = await auditSchema(business.website);
                return { ...business, audit };
            })
        );

        results.push(...batchResults);
        processed += batch.length;

        // Progress indicator
        const percent = Math.round((processed / businesses.length) * 100);
        process.stdout.write(`\r   Progress: ${processed}/${businesses.length} (${percent}%)`);
    }

    console.log('\n✅ Schema audits complete');
    return results;
}

/**
 * Step 4: Filter for leads (missing or broken schema)
 */
function filterLeads(auditedBusinesses) {
    const leads = auditedBusinesses.filter(business => {
        // Lead if: no schema, or low score, or has issues
        return !business.audit.hasSchema ||
               business.audit.score < 50 ||
               business.audit.issues.length > 0;
    });

    // Sort by review count (higher = better lead)
    leads.sort((a, b) => (b.reviews || 0) - (a.reviews || 0));

    console.log(`\n📊 Results:`);
    console.log(`   Total businesses: ${auditedBusinesses.length}`);
    console.log(`   With websites: ${auditedBusinesses.length}`);
    console.log(`   Missing/broken schema: ${leads.length} (${Math.round(leads.length/auditedBusinesses.length*100)}%)`);

    return leads;
}

/**
 * Step 5: Generate output report
 */
async function generateReport(leads, niche, location) {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `leads-${niche.replace(/\s+/g, '-')}-${location.replace(/\s+/g, '-')}-${timestamp}`;

    // CSV output
    const csvHeader = 'Name,Website,Phone,Address,Rating,Reviews,Schema Status,Issues\n';
    const csvRows = leads.map(lead => {
        const schemaStatus = lead.audit.hasSchema ?
            `Has schema (${lead.audit.schemaTypes.join(', ')})` :
            'NO SCHEMA';
        const issues = lead.audit.issues.join('; ').replace(/,/g, ';');

        return [
            `"${lead.name}"`,
            lead.website,
            lead.phone || '',
            `"${lead.address || ''}"`,
            lead.rating || '',
            lead.reviews || '',
            schemaStatus,
            `"${issues}"`
        ].join(',');
    }).join('\n');

    const csvContent = csvHeader + csvRows;

    // Save files
    const outputDir = path.join(__dirname, '..', 'output');
    await fs.mkdir(outputDir, { recursive: true });

    await fs.writeFile(path.join(outputDir, `${filename}.csv`), csvContent);

    // JSON output (for API integrations)
    await fs.writeFile(
        path.join(outputDir, `${filename}.json`),
        JSON.stringify({
            meta: { niche, location, timestamp, totalLeads: leads.length },
            leads
        }, null, 2)
    );

    console.log(`\n📁 Output saved to:`);
    console.log(`   ${outputDir}/${filename}.csv`);
    console.log(`   ${outputDir}/${filename}.json`);

    return { csv: `${filename}.csv`, json: `${filename}.json` };
}

/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log('Usage: node index.js <niche> <location> [--limit N]');
        console.log('Example: node index.js "dentist" "chicago" --limit 50');
        process.exit(1);
    }

    const niche = args[0];
    const location = args[1];
    const limitIndex = args.indexOf('--limit');
    const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : 100;

    console.log('═══════════════════════════════════════════════════════');
    console.log('  SCHEMA-MISSING BUSINESS FINDER');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Niche: ${niche}`);
    console.log(`  Location: ${location}`);
    console.log(`  Limit: ${limit} businesses`);
    console.log('═══════════════════════════════════════════════════════\n');

    try {
        // Step 1: Scrape Google Maps
        const businesses = await scrapeGoogleMaps(niche, location, limit);

        if (businesses.length === 0) {
            console.log('❌ No businesses with websites found');
            process.exit(1);
        }

        // Step 2 & 3: Audit schemas
        const audited = await batchAuditSchemas(businesses);

        // Step 4: Filter leads
        const leads = filterLeads(audited);

        // Step 5: Generate report
        await generateReport(leads, niche, location);

        console.log('\n✅ Pipeline complete!');
        console.log(`\n💰 ${leads.length} qualified leads ready for outreach`);

    } catch (error) {
        console.error('\n❌ Pipeline failed:', error.message);
        process.exit(1);
    }
}

// Export for programmatic use
module.exports = { scrapeGoogleMaps, auditSchema, batchAuditSchemas, filterLeads, generateReport };

// Run if called directly
if (require.main === module) {
    main();
}
