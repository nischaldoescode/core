import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
} from '@omss/framework';
import axios from 'axios';
import { IcefyResponse } from './icefy.types.js';

export class IcefyProvider extends BaseProvider {
    readonly id = 'Icefy';
    readonly name = 'Icefy';
    readonly enabled = true;
    readonly BASE_URL = 'https://streams.icefy.top';
    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: "https://embed.icefy.top/",
        Origin: "https://embed.icefy.top"
    };

    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv']
    };

    /**
     * Fetch movie sources
     */
    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    /**
     * Fetch TV episode sources
     */
    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    /**
     * Main scraping logic
     */
    private async getSources(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        try {
            // Build page URL
            const pageUrl = this.buildPageUrl(media);

            // Fetch page json
            const req = await fetch(pageUrl, {
                method: 'GET',
                headers: this.HEADERS
            })
            if (!req.ok) {
                return this.emptyResult(`HTTP error ${req.status}`, media);
            }

            const data = await req.json() as unknown as IcefyResponse;
            if (!data) {
                return this.emptyResult('Failed to fetch page', media);
            }

            const result: ProviderResult = {
                sources: [
                    {
                        url: this.createProxyUrl(data.url, this.HEADERS),
                        quality: '1080p',
                        type: 'hls',
                        audioTracks: [
                            {
                                label: 'English',
                                language: 'eng'
                            }
                        ],
                        provider: {
                            name: this.name,
                            id: this.id
                        }
                    }
                ],
                subtitles: [],
                diagnostics: []
            };

            return result;
        } catch (error) {
            return this.emptyResult(
                error instanceof Error
                    ? error.message
                    : 'Unknown provider error',
                media
            );
        }
    }

    /**
     * Build page URL based on media type
     */
    private buildPageUrl(media: ProviderMediaObject): string {
        if (media.type === 'movie') {
            return `${this.BASE_URL}/movie/${media.tmdbId}`;
        } else {
            return `${this.BASE_URL}/tv/${media.tmdbId}/${media.s}/${media.e}`;
        }
    }

    /**
     * Return empty result with diagnostic
     */
    private emptyResult(
        message: string,
        media: ProviderMediaObject
    ): ProviderResult {
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

    /**
     * Health check
     */
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
