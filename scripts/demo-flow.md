# Demo Walkthrough — Oracle Pipeline, Duval County

## Prerequisites

- Deployed frontend accessible at the Amplify URL
- Pipeline has completed at least 2 runs with ingested data
- IPFS/IPNS pointers are live and resolving

---

## Step 1: Dashboard

1. Open the frontend URL in a browser
2. Navigate to **Dashboard** (should be the default landing page)
3. Point out:
   - **Total Properties** card showing record count with delta from last run
   - **Last Run** card showing timestamp and delta counts (new/updated/removed)
   - **IPNS Status** card showing Live indicator and CID prefix
   - **Sources** card showing healthy source count
4. Scroll to **Records by Source** table:
   - Show each source (Appraiser, Permits, Ownership, GIS, Business, Contractor)
   - Highlight record counts and last collected timestamps
   - Point out status badges (green = healthy)
5. Show **Elephant IPFS & MCP** section:
   - Open Data IPNS link (click to verify it resolves on IPFS gateway)
   - Query Table IPNS link
   - MCP endpoint status

---

## Step 2: Pipeline Runs

1. Navigate to **Pipeline Runs** page
2. Show the chronological run history table:
   - Run numbers, timestamps, status badges
   - New/Updated/Removed delta columns
3. Click **Trigger Run** button (if demonstrating live pipeline)
4. **Expand a completed run** to show details:
   - Per-source breakdown (source name, records ingested, avg time, issues)
   - Published artifact section (CID, IPNS pointer)
   - Webhook delivery status (HTTP code, latency)
   - Source limitations (if any)
5. Show pagination working across multiple runs

---

## Step 3: Property Search

Run each of the 6 required query types:

1. **Roofs older than 15 years**
   - Select from dropdown, show results count
   - Note the Signal column showing roof age values
2. **View of water**
   - Show waterfront properties with water_proximity_ft values
3. **No ownership change in 10+ years**
   - Show properties with high ownership_tenure_years
4. **Regional owners**
   - Show properties where is_regional_owner = true
5. **Walking distance to public transit**
   - Show properties within 0.5mi of transit stops
6. **Walking distance to Starbucks**
   - Show properties within 0.5mi of Starbucks locations

For at least 2 results:
- **Click a row** to open the Property Detail Drawer
- Show all attributes: parcel ID, address, assessed value, year built, sqft, owner
- Show derived signals: roof age, water proximity, transit distance
- Show **Source Provenance** section with contributing sources and timestamps
- Show reconciliation confidence score

---

## Step 4: Agent Chat

Ask 3 multi-attribute queries that demonstrate source-backed evidence:

### Query 1: Multi-criteria search
> "Find properties near water with roofs older than 20 years and assessed values over $200,000"

- Point out the DuckDB SQL query the agent generated
- Show result cards with parcel IDs, addresses, and signal values
- Highlight source provenance on each result

### Query 2: Specific property lookup
> "Tell me everything about parcel RE0001234" (use a real parcel ID from earlier search)

- Show the comprehensive property detail response
- Point out all attributes and their contributing sources
- Note the data freshness indicator (last pipeline run timestamp)

### Query 3: Analytical question
> "How many waterfront properties in Duval County are owned by regional owners?"

- Show the agent using a COUNT/aggregate SQL query
- Point out the data source attribution (Published Parquet via DuckDB on IPFS/IPNS)

---

## Wrap-up

- Return to Dashboard to show real-time stats reflecting the demo activity
- Mention that all data is published to IPFS (content-addressed, verifiable)
- Note the MCP endpoint for external tool integration
- Highlight the pipeline runs automatically on schedule with incremental detection

---

## Recording Notes

- Target duration: 3-5 minutes
- Resolution: 1920x1080
- Use a clean browser profile (no extensions visible)
- Speak clearly and point out key features as you navigate
- Pause briefly on each section to allow the viewer to read the data
