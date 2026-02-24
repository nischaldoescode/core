// 2embed.ts
// provider for 2embed.cc

import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Source,
    Subtitle,
    SubtitleFormat
} from '@omss/framework';
import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import JsUnpacker from './jsunpack.js';
import type {
    TwoEmbedResolvedStream,
    TwoEmbedSetupConfig,
    TwoEmbedLinks
} from './2embed.types.js';

const DOMAIN = 'https://www.2embed.cc';
const PLAYER_URL = 'https://uqloads.xyz';

// debug log helper - only logs when NODE_ENV=development
const DEBUG_DEV = process.env.NODE_ENV === 'development';
const DEBUG_logs = (label: string, data?: unknown) => {
    if (!DEBUG_DEV) return;
    console.log(`[debug] ${label}`, data !== undefined ? data : '');
};

// parse quality string to numeric value for comparison
function parseQuality(qualityString: string | undefined): number {
    if (!qualityString) return 0;
    const q = qualityString.toUpperCase();
    if (q === '4K') return 4000;
    if (q.includes('1080P')) return 1080;
    if (q.includes('720P')) return 720;
    const numMatch = q.match(/(\d+)/);
    return numMatch ? parseInt(numMatch[1], 10) : 0;
}

// parse subtitles from unpacked js and return as subtitle array
function parseSubs(scriptstring: string): Subtitle[] {
    const subtitles: Subtitle[] = [];

    try {
        const linksMatch = scriptstring.match(/var links\s*=\s*({[^;]*});/);
        if (!linksMatch) return subtitles;

        let linksStr = linksMatch[1]
            .replace(/'/g, '"')
            .replace(/([{,]\s*)([a-zA-Z0-9_$]+)(\s*:)/g, '$1"$2"$3');

        const links = JSON.parse(linksStr) as TwoEmbedLinks;
        const videoUrl = links.hls2;

        const setupMatch = scriptstring.match(
            /jwplayer\(["']vplayer["']\)\.setup\((\{[\s\S]*?\})\);[\s\S]*?$/
        );
        if (!setupMatch?.[1]) return subtitles;

        let setupStr = setupMatch[1];
        setupStr = setupStr.replace(
            /links\.hls4\s*\|\|\s*links\.hls2/g,
            `"${videoUrl}"`
        );
        setupStr = setupStr
            .replace(/\\'/g, "'")
            .replace(/([{,]\s*)([a-zA-Z0-9_$]+)(\s*:)/g, '$1"$2"$3')
            .replace(/'/g, '"')
            .replace(/,\s*([}\]])/g, '$1')
            .replace(/"true"/g, 'true')
            .replace(/"false"/g, 'false')
            .replace(/"null"/g, 'null');

        let setupConfig: TwoEmbedSetupConfig;
        try {
            setupConfig = JSON.parse(setupStr) as TwoEmbedSetupConfig;
        } catch {
            return subtitles;
        }

        if (!setupConfig.tracks) return subtitles;

        const tracks: Subtitle[] = setupConfig.tracks
            .filter((t) => t && (t.kind === 'captions' || t.kind === 'subtitles') && t.file)
            .map((t) => ({
                url: t.file,
                label: t.label ?? t.kind,
                format: 'vtt' as SubtitleFormat
            }));

        subtitles.push(...tracks);
    } catch {
        // subtitle parsing failed, return empty
    }

    return subtitles;
}

// resolve uqloads player url to actual hls stream url
async function resolveStream(
    url: string,
    referer: string
): Promise<TwoEmbedResolvedStream | null> {
    try {
        const response = await axios.get(url, {
            headers: {
                Referer: referer,
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        if (response.status !== 200) return null;

        const data = response.data as string;
        const packedDataMatch = data.match(/eval\(function(.*?)split.*\)\)\)/s);
        if (!packedDataMatch) {
            // if url itself is m3u8 return directly
            if (url.includes('.m3u8')) return { streamUrl: url, subtitles: [] };
            return null;
        }

        const unpacker = new JsUnpacker(packedDataMatch[0]);
        if (!unpacker.detect()) return null;

        const unpackedJS = unpacker.unpack();
        if (!unpackedJS) return null;

        DEBUG_logs('unpacked js length', unpackedJS.length);

        const subtitles = parseSubs(unpackedJS);

        // try hls2 format first then fallback to sources format
        if (unpackedJS.includes('"hls2":"https')) {
            const match = unpackedJS.match(/links=.*hls2\":\"(.*?)\"};/);
            if (match?.[1]) return { streamUrl: match[1], subtitles };
        } else {
            const match = unpackedJS.match(
                /sources\s*:\s*\[\s*\{\s*file\s*:\s*"([^"]+)"/
            );
            if (match?.[1]) return { streamUrl: match[1], subtitles };
        }

        return null;
    } catch {
        return null;
    }
}

export class TwoEmbedProvider extends BaseProvider {
    readonly id = 'twoembed';
    readonly name = '2Embed';
    readonly enabled = true;
    readonly BASE_URL = DOMAIN;
    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: DOMAIN,
        Origin: DOMAIN
    };

    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv']
    };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    private async getSources(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        try {
            // build the initial embed url
            const embedUrl =
                media.type === 'tv'
                    ? `${DOMAIN}/embed/tv/${media.tmdbId}&s=${media.s}&e=${media.e}`
                    : `${DOMAIN}/embed/${media.tmdbId}`;

            DEBUG_logs('embed url', embedUrl);

            // post to get the player page content
            const response = await axios.post(embedUrl, 'pls=pls', {
                headers: {
                    Referer: embedUrl,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': this.HEADERS['User-Agent']
                },
                timeout: 10000
            });

            if (response.status !== 200) {
                return this.emptyResult('failed to fetch embed page');
            }

            const data = response.data as string;

            // check for swish id or player4u url in response
            const match =
                data.match(/swish\?id=(?<id>[\w\d]+)/) ||
                data.match(/'(.*?player4u.*?)'/);

            if (!match?.[1]) {
                return this.emptyResult('no player id found in response');
            }

            const extractedValue = match[1];
            const isSwishId = match[0].includes('swish');

            DEBUG_logs('extracted value', { extractedValue, isSwishId });

            if (isSwishId) {
                // direct swish player resolve
                const resolved = await resolveStream(
                    `${PLAYER_URL}/e/${extractedValue}`,
                    DOMAIN
                );

                if (!resolved) {
                    return this.emptyResult(
                        `could not resolve stream for swish id: ${extractedValue}`
                    );
                }

                const source: Source = {
                    url: this.createProxyUrl(resolved.streamUrl, {
                        ...this.HEADERS,
                        Referer: extractedValue
                    }),
                    type: 'hls',
                    quality: '1080p',
                    audioTracks: [{ language: 'eng', label: 'English' }],
                    provider: { id: this.id, name: this.name }
                };

                return { sources: [source], subtitles: resolved.subtitles, diagnostics: [] };
            } else {
                // player4u path - fetch list page and pick highest quality
                const listResponse = await axios.get(extractedValue, {
                    headers: { Referer: embedUrl },
                    timeout: 10000
                });

                if (listResponse.status !== 200) {
                    return this.emptyResult(
                        `failed to fetch player4u list page: ${listResponse.status}`
                    );
                }

                const $ = cheerio.load(listResponse.data as string);
                let highestQuality = -1;
                let bestPartialUrl: string | null = null;

                // find highest quality stream link from the list
                $('li.slide-toggle a.playbtnx').each((_: number, element: Element) => {
                    const linkText = $(element).text();
                    const onclickAttr = $(element).attr('onclick');
                    if (!linkText || !onclickAttr) return;

                    const qualityMatch = linkText.match(/\s*(\d+p|4K)\s*/i);
                    const qualityString = qualityMatch
                        ? qualityMatch[1].toUpperCase()
                        : null;

                    const urlMatch = onclickAttr.match(/go\('([^']+)'\)/);
                    const partialUrl = urlMatch ? urlMatch[1] : null;

                    if (!qualityString || !partialUrl) return;

                    const qualityValue = parseQuality(qualityString);
                    if (qualityValue > highestQuality) {
                        highestQuality = qualityValue;
                        bestPartialUrl = partialUrl;
                    }
                });

                if (!bestPartialUrl) {
                    return this.emptyResult('no valid quality options on player4u page');
                }

                const idMatch = (bestPartialUrl as string).match(/\?id=([\w\d]+)/);
                if (!idMatch?.[1]) {
                    return this.emptyResult('could not extract player4u id from url');
                }

                const resolveUrl = `${PLAYER_URL}/e/${idMatch[1]}`;
                DEBUG_logs('resolving player4u', resolveUrl);

                const resolved = await resolveStream(resolveUrl, extractedValue);
                if (!resolved) {
                    return this.emptyResult(
                        `could not resolve stream for player4u id: ${idMatch[1]}`
                    );
                }

                const quality =
                    highestQuality > 0 ? `${highestQuality}p` : '1080p';

                const source: Source = {
                    url: this.createProxyUrl(resolved.streamUrl, {
                        ...this.HEADERS,
                        Referer: extractedValue
                    }),
                    type: 'hls',
                    quality,
                    audioTracks: [{ language: 'eng', label: 'English' }],
                    provider: { id: this.id, name: this.name }
                };

                return {
                    sources: [source],
                    subtitles: resolved.subtitles,
                    diagnostics: []
                };
            }
        } catch (error) {
            return this.emptyResult(
                error instanceof Error ? error.message : 'unknown provider error'
            );
        }
    }

    private emptyResult(message: string): ProviderResult {
        return {
            sources: [],
            subtitles: [],
            diagnostics: [
                {
                    code: 'PROVIDER_ERROR',
                    message: `${this.name}: ${message}`,
                    field: '',
                    severity: 'error'
                }
            ]
        };
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await axios.head(this.BASE_URL, {
                timeout: 5000,
                headers: this.HEADERS
            });
            return response.status === 200;
        } catch {
            return false;
        }
    }
}