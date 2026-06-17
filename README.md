# 🌾 Harvest Library

Harvest is a lean, self-hosted media catalog management and PWA ingestion engine. It monitors external syndication feeds (like RSS torrent trackers), automatically parses release strings, maps them against local media catalogs using metadata match cycles, and presents a beautiful storefront for consumers along with a robust suite of admin triage controls.

---

## 🏗️ Architecture Layer Overview

The platform operates as a multi-container Docker stack split across three primary tiers:

* **Frontend (Vite + React):** A single-page architecture providing a mobile-friendly consumer viewport for streaming directories and an integrated tabbed administrator control panel (`dashboard.jsx`) for pipeline management.
* **Backend (Node.js + Express):** Orchestrates the scraper cron-jobs, sanitizes string matches, manages metadata hooks, and serves the core JSON abstraction API.
* **Database (PostgreSQL):** A relational data store housing ingested stream items, mapped series records, and live source configurations with schema integrity rules.

---

## 🚀 Quick Start & Deployment

### 1. Prerequisites
Ensure you have **Docker** and **Docker Compose** installed on your host system.

### 2. Clone and Configure Schema
Ensure your database initialization script is placed at `database/init.sql`. Your table schemas should include the latest volume-safe structural adjustments:

```sql
-- Enforce single unique combinations for series episode indices
ALTER TABLE metadata_episodes 
ADD CONSTRAINT unique_show_season_episode 
UNIQUE (metadata_item_id, season_number, episode_number);

-- Ensure raw intake fields accommodate elongated release strings
ALTER TABLE scraped_entries ALTER COLUMN title TYPE VARCHAR(500);
ALTER TABLE scraped_entries ALTER COLUMN category TYPE VARCHAR(255);
```

### 3. Spin Up the Stack
Launch the environment in detached mode using your terminal:

```bash
docker compose up -d
```
Access the library UI directly via your web browser at `http://localhost:3030`.

---

## ⚙️ Administration & Routing
The system features persistent hash-routing to prevent session loss during manual browser reloads:

* **Library Storefront View:** `http://localhost:3030/`

* **Admin Dashboard View:** `http://localhost:3030/#admin`

**Interactive Source Deployment**
Instead of manually modifying static database files or resetting data volumes, you can register new scraping endpoints dynamically:

1. Navigate to the **Sources** tab within the Admin view.

2. Complete the **Add Ingestion Source** form layout.

3. Supply a custom JSON mapping schema to fit your tracker's XML formatting structure:

```json
JSON
{
  "parser": "xml",
  "selectors": {
    "item": "item",
    "title": "title",
    "source_link": "link",
    "date_published": "pubDate",
    "category": "category",
    "description": "description",
    "magnet_link": "enclosure"
  }
}
```

4. Click **Save and Deploy Source**. The backend immediately activates the worker routine for the new pool.

---

## 🛠️ Diagnostics & Maintenance Commands
Force a Manual Sync Execution
If you do not want to wait for the automatic 30-minute interval window, navigate to the **Admin** tab panel on the web interface and click `⚙️ Force Sync & Match`. This immediately activates the scraping pipeline runner.

### Check Container Health & Status
If the web service reports connection drops, verify your engine containers are running via PowerShell/Terminal:

```bash
docker compose ps
```

### Stream Live Container Logging
To inspect runtime matching errors, column queries, or incoming scraping logs live:

```bash
docker compose logs -f harvest_backend
```

---

## 📄 License
Internal Application Deployment — All Rights Reserved.