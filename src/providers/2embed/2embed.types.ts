// twoembed.types.ts
// type definitions for 2embed player response structures
import type {
    Subtitle
} from '@omss/framework';

// quality option scraped from player4u list page
export interface TwoEmbedQualityOption {
    qualityString: string;
    partialUrl: string;
}

// result from resolving a uqloads player url
export interface TwoEmbedResolvedStream {
    streamUrl: string;
    subtitles: Subtitle[];
}

// parsed links object from packed js
export interface TwoEmbedLinks {
    hls2?: string;
    hls4?: string;
    [key: string]: string | undefined;
}

// parsed jwplayer track from setup config
export interface TwoEmbedTrack {
    kind: 'captions' | 'subtitles' | string;
    file: string;
    label?: string;
}

// parsed jwplayer setup config (partial, only what we use)
export interface TwoEmbedSetupConfig {
    tracks?: TwoEmbedTrack[];
    sources?: Array<{ file: string; type?: string }>;
}