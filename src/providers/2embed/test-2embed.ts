// 2embed.ts
// quick script for 2embed provider
// usage: npx tsx src/providers/twoembed/2embed.ts

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// walk up to root where .env lives
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import axios from 'axios';
import { TwoEmbedProvider } from './2embed.js';

// inline type to avoid @omss/framework import issues in scripts
type ProviderMediaObject = {
    type: 'movie' | 'tv';
    tmdbId: string;
    s?: number;
    e?: number;
    releaseYear?: string;
    imdbId?: string;
    title?: string;
};

// debug log helper
const DEBUG_DEV = process.env.NODE_ENV === 'development';
const DEBUG_logs = (label: string, data?: unknown) => {
    if (!DEBUG_DEV) return;
    console.log(`[debug] ${label}`, data !== undefined ? data : '');
};

// fetches tmdb id, title, and year for a given query
async function fetchTmdbId(
    apiKey: string,
    type: 'movie' | 'tv',
    query: string
): Promise<{ id: string; title: string; year: string } | null> {
    const endpoint =
        type === 'movie'
            ? 'https://api.themoviedb.org/3/search/movie'
            : 'https://api.themoviedb.org/3/search/tv';

    DEBUG_logs('fetching tmdb id', { type, query });

    const res = await axios.get(endpoint, {
        params: { api_key: apiKey, query },
        timeout: 8000
    });

    const result = res.data.results?.[0];
    if (!result) return null;

    const title = result.title ?? result.name ?? 'unknown';
    const rawDate = result.release_date ?? result.first_air_date ?? '';
    const year = rawDate.slice(0, 4);

    DEBUG_logs('tmdb result', { id: result.id, title, year });

    return { id: String(result.id), title, year };
}

// prints provider output in readable format
function printResult(
    label: string,
    media: ProviderMediaObject,
    result: Awaited<ReturnType<TwoEmbedProvider['getMovieSources']>>
) {
    console.log('\n========================================');
    console.log(`[result] ${label}`);
    console.log(
        `[media]  type=${media.type} tmdbId=${media.tmdbId}${media.type === 'tv' ? ` s=${media.s} e=${media.e}` : ''} title=${media.title ?? 'n/a'}`
    );
    console.log('----------------------------------------');
    console.log(`[sources]    count=${result.sources.length}`);

    result.sources.forEach((src, i) => {
        console.log(`  [${i + 1}] quality=${src.quality} type=${src.type}`);
        console.log(`       lang=${src.audioTracks?.[0]?.label ?? 'unknown'}`);
        DEBUG_logs(`source[${i + 1}] url`, src.url);
    });

    console.log(`[subtitles]  count=${result.subtitles.length}`);
    result.subtitles.forEach((sub, i) => {
        console.log(`  [${i + 1}] label=${sub.label} format=${sub.format}`);
        DEBUG_logs(`subtitle[${i + 1}] url`, sub.url);
    });

    if (result.diagnostics.length > 0) {
        console.log(`[diagnostics] count=${result.diagnostics.length}`);
        result.diagnostics.forEach((d) => {
            console.log(`  [${d.severity}] ${d.code} - ${d.message}`);
        });
    }

    console.log('========================================\n');
}

async function runTests() {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;

    if (!TMDB_API_KEY) {
        console.error('[error] TMDB_API_KEY env var is required');
        console.error('        make sure .env exists at project root');
        process.exit(1);
    }

    console.log('[init] starting 2embed provider');
    DEBUG_logs('debug mode active');

    const provider = new TwoEmbedProvider();
    console.log(
        `[init] provider id=${provider.id} name=${provider.name} enabled=${provider.enabled}`
    );

    // health check
    console.log('\n[health] checking provider availability...');
    const healthy = await provider.healthCheck();
    console.log(`[health] status=${healthy ? 'ok' : 'unreachable'}`);

    if (!healthy) {
        console.warn('[warn] provider health check failed - continuing anyway');
    }

    // movie
    console.log('\nfetching movie sources');
    const movieQuery = 'Inception';
    const movieTmdb = await fetchTmdbId(TMDB_API_KEY, 'movie', movieQuery);

    if (!movieTmdb) {
        console.error(`[error] could not find tmdb entry for: ${movieQuery}`);
    } else {
        const movieMedia: ProviderMediaObject = {
            type: 'movie',
            tmdbId: movieTmdb.id,
            title: movieTmdb.title,
            releaseYear: movieTmdb.year
        };

        DEBUG_logs('movie media object', movieMedia);
        console.log(
            `tmdbId=${movieTmdb.id} title="${movieTmdb.title}" year=${movieTmdb.year}`
        );

        const movieResult = await provider.getMovieSources(movieMedia);
        printResult('movie', movieMedia, movieResult);
    }

    // tv
    console.log('fetching tv episode sources');
    const tvQuery = 'Breaking Bad';
    const tvTmdb = await fetchTmdbId(TMDB_API_KEY, 'tv', tvQuery);

    if (!tvTmdb) {
        console.error(`[error] could not find tmdb entry for: ${tvQuery}`);
    } else {
        const tvMedia: ProviderMediaObject = {
            type: 'tv',
            tmdbId: tvTmdb.id,
            title: tvTmdb.title,
            s: 1,
            e: 1
        };

        DEBUG_logs('tv media object', tvMedia);
        console.log(
            `tmdbId=${tvTmdb.id} title="${tvTmdb.title}" s=1 e=1`
        );

        const tvResult = await provider.getTVSources(tvMedia);
        printResult('tv', tvMedia, tvResult);
    }

    console.log('[done] all finished');
}

runTests().catch((err) => {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exit(1);
});