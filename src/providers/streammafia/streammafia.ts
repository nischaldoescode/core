import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Subtitle,
    AudioTrack,
    Diagnostic,
    Source,
    SourceType
} from '@omss/framework';
import { BaseProvider } from '@omss/framework';
import axios from 'axios';
import { ApiResponse } from './streammafia.types.js';

export class StreamMafiaProvider extends BaseProvider {
    readonly id = 'streammafia';
    readonly name = 'MafiaEmbed';
    readonly enabled = true;

    readonly BASE_URL = 'https://streammafiacdn.in';
    readonly EMBED_URL = 'https://embed.streammafia.to';

    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: this.BASE_URL,
        Origin: this.BASE_URL
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

    async healthCheck(): Promise<boolean> {
        try {
            const res = await axios.head(this.EMBED_URL, {
                timeout: 5000
            });
            return res.status === 200;
        } catch {
            return false;
        }
    }

    private async getSources(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        try {
            const url = this.buildPageUrl(media);
            const api = await this.fetchPage(url);

            if (!api || api.status !== 'success') {
                return this.emptyResult('Invalid API response');
            }

            return await this.mapApiResponse(api);
        } catch (err) {
            return this.emptyResult(
                err instanceof Error ? err.message : 'Unknown error'
            );
        }
    }

    private buildPageUrl(media: ProviderMediaObject): string {
        if (media.type === 'movie') {
            return `${this.BASE_URL}/goal/?movie_tmdb_id=${media.tmdbId}`;
        }

        return `${this.BASE_URL}/goal/?tv_tmdb_id=${media.tmdbId}&season=${media.s}&episode=${media.e}`;
    }

    private async fetchPage(url: string): Promise<ApiResponse | null> {
        try {
            const res = await axios.get(url, { headers: this.HEADERS });
            return typeof res.data === 'string'
                ? JSON.parse(res.data)
                : res.data;
        } catch {
            return null;
        }
    }

    private async mapApiResponse(api: ApiResponse): Promise<ProviderResult> {
        const sources: Source[] = [];
        const subtitles: Subtitle[] = [];
        const diagnostics: Diagnostic[] = [];

        for (const file of api.data ?? []) {
            const audioTracks = [this.extractAudioFromTitle(file.title)];

            if (file.stream?.hls_streaming) {
                const parsed = await this.parseHLS(file.stream.hls_streaming);

                sources.push({
                    url: this.createProxyUrl(file.stream.hls_streaming, {
                        ...this.HEADERS,
                        Referer: this.EMBED_URL,
                        Origin: this.EMBED_URL
                    }),
                    type: 'hls',
                    quality: parsed.quality,
                    audioTracks:
                        parsed.audioTracks.length > 0
                            ? parsed.audioTracks
                            : audioTracks,
                    provider: {
                        id: this.id,
                        name: this.name
                    }
                });
            }

            for (const download of file.stream?.download ?? []) {
                sources.push({
                    url: this.createProxyUrl(download.url, {
                        ...this.HEADERS,
                        Referer: this.EMBED_URL,
                        Origin: this.EMBED_URL
                    }),
                    type: this.inferSourceType(download.url),
                    quality: this.normalizeQuality(download.quality, 'auto'),
                    audioTracks,
                    provider: {
                        id: this.id,
                        name: this.name
                    }
                });
            }
        }

        return { sources, subtitles, diagnostics };
    }

    private extractAudioFromTitle(title: string): AudioTrack {
        const match = title.match(/\(([^)]+)\)$/);
        let lang = match?.[1]?.toLowerCase() ?? 'unknown';

        if (lang === 'default') lang = 'en';
        if (lang === 'original') lang = 'unknown';

        return {
            language: lang,
            label: lang.toUpperCase()
        };
    }

    private async parseHLS(url: string): Promise<{
        quality: string;
        audioTracks: AudioTrack[];
    }> {
        try {
            const res = await axios.get(url, {
                headers: {
                    ...this.HEADERS,
                    Referer: this.EMBED_URL
                }
            });

            const content: string = res.data;

            const variants = this.parseVariants(content);
            const audioTracks = this.parseAudioTracks(content);

            if (variants.length === 0) {
                return { quality: 'auto', audioTracks };
            }

            const best = variants.reduce((a, b) =>
                b.resolution > a.resolution ? b : a
            );

            return {
                quality: `${best.resolution}p`,
                audioTracks
            };
        } catch {
            return { quality: 'auto', audioTracks: [] };
        }
    }

    private parseVariants(content: string): Array<{ resolution: number }> {
        const variants: Array<{ resolution: number }> = [];

        const regex = /RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g;

        let match;
        while ((match = regex.exec(content)) !== null) {
            variants.push({
                resolution: parseInt(match[1], 10)
            });
        }

        return variants;
    }

    private parseAudioTracks(content: string): AudioTrack[] {
        const tracks: AudioTrack[] = [];
        const lines = content.split('\n');

        for (const line of lines) {
            if (!line.includes('TYPE=AUDIO')) continue;

            const lang = line.match(/LANGUAGE="([^"]+)"/)?.[1] ?? 'unknown';
            const name = line.match(/NAME="([^"]+)"/)?.[1] ?? lang;

            tracks.push({
                language: lang,
                label: name
            });
        }

        return tracks;
    }

    private inferSourceType(url: string): SourceType {
        const clean = url.toLowerCase().split('?')[0];

        if (clean.endsWith('.m3u8')) return 'hls';
        if (clean.endsWith('.mp4')) return 'mp4';
        return 'hls';
    }

    private normalizeQuality(value?: string, fallback = 'unknown'): string {
        if (!value) return fallback;

        const v = value.toLowerCase();

        if (v.includes('2160')) return '2160p';
        if (v.includes('1080')) return '1080p';
        if (v.includes('720')) return '720p';
        if (v.includes('480')) return '480p';
        if (v.includes('360')) return '360p';
        if (v.includes('240')) return '240p';

        return value.toLowerCase() + 'p';
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
}
