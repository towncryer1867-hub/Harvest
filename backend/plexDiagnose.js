/**
 * Plex sync diagnostics.
 *
 * Run from inside the backend container so it uses the same network path
 * and env vars the real sync uses:
 *
 *   docker compose exec backend node plexDiagnose.js
 *
 * Checks, in order (each one isolates a different failure mode):
 *   1. Env vars present at all
 *   2. Raw network reachability to PLEX_SERVER_URL (no auth needed)
 *   3. Token validity (authenticated request)
 *   4. Library sections visible, and whether TV/Movie section filters
 *      (if set) actually match something
 *   5. Sample items from each section with their raw Guid[] arrays, so
 *      you can see whether Plex is actually reporting tvdb:// ids
 *   6. Cross-check a handful of your Harvest shows/movies against what
 *      Plex returned, with a plain-English verdict for each
 */
const axios = require('axios');
const { Pool } = require('pg');
const PlexClient = require('./plexClient');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

function line() {
  console.log('-'.repeat(70));
}

async function main() {
  line();
  console.log('PLEX SYNC DIAGNOSTICS');
  line();

  // ---------------------------------------------------------------
  // 1. Env vars
  // ---------------------------------------------------------------
  const baseUrl = (process.env.PLEX_SERVER_URL || '').replace(/\/$/, '');
  const token = process.env.PLEX_TOKEN || '';
  const tvFilter = process.env.PLEX_TV_SECTION_ID || null;
  const movieFilter = process.env.PLEX_MOVIE_SECTION_ID || null;

  console.log(`PLEX_SERVER_URL      = ${baseUrl || '(not set)'}`);
  console.log(`PLEX_TOKEN            = ${token ? `set (${token.length} chars)` : '(not set)'}`);
  console.log(`PLEX_TV_SECTION_ID    = ${tvFilter || '(not set — will scan all TV sections)'}`);
  console.log(`PLEX_MOVIE_SECTION_ID = ${movieFilter || '(not set — will scan all Movie sections)'}`);

  if (!baseUrl || !token) {
    console.log('\n❌ Missing PLEX_SERVER_URL or PLEX_TOKEN. Nothing else to check — set these and re-run.');
    await pool.end();
    return;
  }

  // ---------------------------------------------------------------
  // 2. Raw reachability (no auth) — isolates Docker/network issues
  //    from auth issues.
  // ---------------------------------------------------------------
  line();
  console.log('STEP 1: Can the backend container reach the Plex server at all?');
  line();
  try {
    const res = await axios.get(`${baseUrl}/identity`, { timeout: 8000 });
    console.log(`✅ Reached ${baseUrl}/identity (HTTP ${res.status}). Network path is fine.`);
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH' || err.code === 'ETIMEDOUT') {
      console.log(`❌ Cannot reach ${baseUrl} from inside the backend container (${err.code}).`);
      console.log(`   Most common cause: PLEX_SERVER_URL points at "localhost" or "127.0.0.1", which`);
      console.log(`   inside a Docker container refers to the container itself, not your host machine`);
      console.log(`   or the Plex machine. Use the Plex machine's actual LAN IP, e.g. http://192.168.1.50:32400.`);
      console.log(`   Also check that nothing (host firewall, router isolation, VLANs) blocks the backend`);
      console.log(`   container's Docker network from reaching that IP — try the same request from the`);
      console.log(`   Docker host itself: curl ${baseUrl}/identity`);
      await pool.end();
      return;
    }
    // Some servers 401 on /identity without a token but still prove reachability
    console.log(`⚠️  Got an error, but it may still mean the server is reachable: ${err.response?.status || err.message}`);
  }

  // ---------------------------------------------------------------
  // 3. Auth
  // ---------------------------------------------------------------
  line();
  console.log('STEP 2: Is the token valid?');
  line();
  const client = new PlexClient({ baseUrl, token });
  let sections = [];
  try {
    sections = await client.getSections();
    console.log(`✅ Token accepted. Found ${sections.length} section(s):`);
    for (const s of sections) {
      console.log(`   - [key=${s.key}] "${s.title}" (type: ${s.type})`);
    }
  } catch (err) {
    console.log(`❌ Auth request failed: ${err.response?.status || ''} ${err.message}`);
    console.log(`   If this is a 401, your PLEX_TOKEN is invalid or expired. Get a fresh one:`);
    console.log(`   https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/`);
    await pool.end();
    return;
  }

  const tvSections = sections.filter((s) => s.type === 'show' && (!tvFilter || String(s.key) === String(tvFilter)));
  const movieSections = sections.filter((s) => s.type === 'movie' && (!movieFilter || String(s.key) === String(movieFilter)));

  if (tvFilter && tvSections.length === 0) {
    console.log(`\n⚠️  PLEX_TV_SECTION_ID=${tvFilter} doesn't match any TV section key above — sync will find 0 shows.`);
  }
  if (movieFilter && movieSections.length === 0) {
    console.log(`\n⚠️  PLEX_MOVIE_SECTION_ID=${movieFilter} doesn't match any Movie section key above — sync will find 0 movies.`);
  }
  if (tvSections.length === 0 && movieSections.length === 0) {
    console.log('\n❌ No TV or Movie sections resolved after filters — nothing for the sync to compare against.');
    await pool.end();
    return;
  }

  // ---------------------------------------------------------------
  // 4/5. Sample items + Guid arrays
  // ---------------------------------------------------------------
  line();
  console.log('STEP 3: Sampling items and their external ids (Guid[]) from each section');
  line();

  const plexShowsByTvdb = new Map();
  const plexMoviesByTvdb = new Map();

  for (const section of tvSections) {
    const items = await client.getSectionItems(section.key);
    console.log(`\nTV section "${section.title}" (key=${section.key}): ${items.length} shows`);
    let withTvdb = 0;
    for (const item of items) {
      const ids = client.extractExternalIds(item);
      if (ids.tvdb) { plexShowsByTvdb.set(String(ids.tvdb), item); withTvdb++; }
    }
    console.log(`  -> ${withTvdb}/${items.length} had a tvdb:// guid`);
    items.slice(0, 3).forEach((item) => {
      const ids = client.extractExternalIds(item);
      const rawGuids = (item.Guid || []).map((g) => g.id).join(', ') || item.guid || '(none)';
      console.log(`     sample: "${item.title}" -> extracted tvdb=${ids.tvdb || 'null'} | raw guids: ${rawGuids}`);
    });
  }

  for (const section of movieSections) {
    const items = await client.getSectionItems(section.key);
    console.log(`\nMovie section "${section.title}" (key=${section.key}): ${items.length} movies`);
    let withTvdb = 0;
    for (const item of items) {
      const ids = client.extractExternalIds(item);
      if (ids.tvdb) { plexMoviesByTvdb.set(String(ids.tvdb), item); withTvdb++; }
    }
    console.log(`  -> ${withTvdb}/${items.length} had a tvdb:// guid`);
    items.slice(0, 3).forEach((item) => {
      const ids = client.extractExternalIds(item);
      const rawGuids = (item.Guid || []).map((g) => g.id).join(', ') || item.guid || '(none)';
      console.log(`     sample: "${item.title}" -> extracted tvdb=${ids.tvdb || 'null'} | raw guids: ${rawGuids}`);
    });
    if (items.length > 0 && withTvdb === 0) {
      console.log(`  ⚠️  None of these movies reported a tvdb:// guid. Plex's default "Plex Movie" agent`);
      console.log(`     sources primarily from TMDB and often omits TVDB ids entirely. If this library uses`);
      console.log(`     that agent, movie matching (which is tvdb_id-only in Harvest) will never succeed`);
      console.log(`     even for movies that are genuinely in your library. Check the library's agent under`);
      console.log(`     Plex Settings -> Libraries -> Edit -> Advanced.`);
    }
  }

  // ---------------------------------------------------------------
  // 6. Cross-check against Harvest
  // ---------------------------------------------------------------
  line();
  console.log('STEP 4: Cross-checking a sample of your Harvest catalog against what Plex returned');
  line();

  const harvestShows = await pool.query(
    `SELECT id, tvdb_id, title, in_plex FROM metadata_shows ORDER BY id LIMIT 5`
  );
  console.log('\nShows:');
  for (const show of harvestShows.rows) {
    const found = plexShowsByTvdb.get(String(show.tvdb_id));
    console.log(
      `  "${show.title}" (tvdb_id=${show.tvdb_id}, currently in_plex=${show.in_plex}) -> ` +
      (found ? `✅ MATCHES Plex item "${found.title}"` : '❌ no tvdb match found in Plex data pulled above')
    );
  }

  const harvestMovies = await pool.query(
    `SELECT id, tvdb_id, title, in_plex FROM metadata_movies ORDER BY id LIMIT 5`
  );
  console.log('\nMovies:');
  for (const movie of harvestMovies.rows) {
    const found = plexMoviesByTvdb.get(String(movie.tvdb_id));
    console.log(
      `  "${movie.title}" (tvdb_id=${movie.tvdb_id}, currently in_plex=${movie.in_plex}) -> ` +
      (found ? `✅ MATCHES Plex item "${found.title}"` : '❌ no tvdb match found in Plex data pulled above')
    );
  }

  line();
  console.log('Done. If shows/movies you know are in Plex still show "no tvdb match" above,');
  console.log('the tvdb_id Harvest stored for them likely differs from what Plex reports —');
  console.log('re-check the raw Guid samples in STEP 3 against the tvdb_id column in your DB.');
  line();

  await pool.end();
}

main().catch(async (err) => {
  console.error('Diagnostic script crashed:', err);
  await pool.end();
  process.exit(1);
});