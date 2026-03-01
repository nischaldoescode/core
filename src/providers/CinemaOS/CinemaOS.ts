// Check TODO at line 40 and 49

import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult
} from '@omss/framework';
import axios from 'axios';
import crypto from 'crypto';
import type {
    CinemaOSDownloadResponse,
    CinemaOSEncryptedResponse,
    CinemaOSParsedSources
} from './cinemaos.types.js';

// hmac secret used to sign the api request
const SECRET_KEY =
    'a8f7e9c2d4b6a1f3e8c9d2b4a7f6e9c2d4b6a1f3e8c9d2b4a7f6e9c2d4b6a1f3';

// password used for pbkdf2 key derivation before aes-gcm decryption
const DECRYPT_PASSWORD =
    'a1b2c3d4e4f6588658455678901477567890abcdef1234567890abcdef123456';

export class CinemaOSProvider extends BaseProvider {
    readonly id = 'CinemaOS';
    readonly name = 'CinemaOS';
    readonly enabled = true;
    readonly BASE_URL = 'https://cinemaos.live';

    // standard headers to mimic a mobile chrome browser
    readonly HEADERS = {
        Origin: this.BASE_URL,
        Referer: this.BASE_URL,
        'User-Agent':
            'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
    };

    // movies only as of now
    // TODO: to add tvshow support
    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies']
    };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    // TODO: to add tvshow support change the response
    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        // tv not supported, return empty with diagnostic
        return this.emptyResult('CinemaOS does not support TV content', media);
    }

    /**
     * main flow:
     * - fetch movie metadata to get title, year, imdb id
     * - sign request with hmac
     * - fetch encrypted source payload
     * - decrypt with aes-256-gcm
     * - return valid sources
     */
    private async getSources(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        try {
            const downloadData = await this.fetchMetadata(media.tmdbId);
            if (!downloadData) {
                return this.emptyResult('no metadata returned', media);
            }

            const { movieTitle, releaseYear, subtitleLink } = downloadData;

            // imdb id is encoded at the end of the subtitle link query param
            const imdbId = subtitleLink?.split('=').pop();

            const hmacSignature = this.buildHmac(media.tmdbId);

            const encryptedData = await this.fetchEncryptedPayload(
                media.tmdbId,
                imdbId ?? '',
                movieTitle,
                releaseYear,
                hmacSignature
            );

            if (!encryptedData) {
                return this.emptyResult('empty encrypted response', media);
            }

            const decrypted = this.decrypt(encryptedData);
            const parsed: CinemaOSParsedSources = JSON.parse(decrypted);
            const sources = parsed?.sources ?? {};

            // filter out any malformed entries without a url
            const validEntries = Object.values(sources).filter(
                (v) => v && typeof v === 'object' && v.url
            );

            if (!validEntries.length) {
                return this.emptyResult('no valid sources found', media);
            }

            return {
                sources: validEntries.map((entry) => ({
                    url: this.createProxyUrl(entry.url, this.HEADERS),
                    quality: 'auto',
                    type: 'hls',
                    // default to english since cinemaos doesn't expose track info
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
                })),
                subtitles: [],
                diagnostics: []
            };
        } catch (error) {
            return this.emptyResult(
                error instanceof Error ? error.message : 'unknown error',
                media
            );
        }
    }

    // fetch movie metadata — returns null on failure instead of throwing
    private async fetchMetadata(tmdbId: string) {
        try {
            const url = `${this.BASE_URL}/api/downloadLinks?type=movie&tmdbId=${tmdbId}`;
            const resp = await axios.get<CinemaOSDownloadResponse>(url, {
                headers: this.HEADERS,
                timeout: 15000
            });
            return resp.data?.data?.[0] ?? null;
        } catch {
            return null;
        }
    }

    /** build hmac-sha256 signature for the cinemaos api request */
    private buildHmac(tmdbId: string): string {
        const message = `media|episodeId:|seasonId:|tmdbId:${tmdbId}`;
        return crypto
            .createHmac('sha256', SECRET_KEY)
            .update(message)
            .digest('hex');
    }

    /** fetch the aes-encrypted source payload from the cinemaos api */
    private async fetchEncryptedPayload(
        tmdbId: string,
        imdbId: string,
        title: string,
        releaseYear: string,
        secret: string
    ) {
        try {
            const params = new URLSearchParams({
                type: 'movie',
                tmdbId,
                imdbId,
                t: title,
                ry: releaseYear,
                secret
            });

            const url = `${this.BASE_URL}/api/cinemaos?${params.toString()}`;
            const resp = await axios.get<CinemaOSEncryptedResponse>(url, {
                headers: {
                    ...this.HEADERS,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            return resp.data?.data ?? null;
        } catch {
            return null;
        }
    }

    /**
     * decrypt aes-256-gcm payload
     * key is derived from DECRYPT_PASSWORD + salt via pbkdf2 (100k iterations)
     * iv = cin, auth tag = mao
     */
    private decrypt(data: {
        encrypted: string;
        cin: string;
        mao: string;
        salt: string;
    }): string {
        const password = Buffer.from(DECRYPT_PASSWORD, 'utf8');
        const saltBuf = Buffer.from(data.salt, 'hex');

        // derive 32-byte key using pbkdf2-sha256
        const key = crypto.pbkdf2Sync(password, saltBuf, 100000, 32, 'sha256');

        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            key,
            Buffer.from(data.cin, 'hex')
        );
        decipher.setAuthTag(Buffer.from(data.mao, 'hex'));

        return (
            decipher.update(
                Buffer.from(data.encrypted, 'hex'),
                undefined,
                'utf8'
            ) + decipher.final('utf8')
        );
    }

    // standard empty result with error diagnostic
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

    // ping the base url to check if cinemaos is reachable
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
