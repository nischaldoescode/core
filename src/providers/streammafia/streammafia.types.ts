export interface ApiResponse {
    status: string;
    data: File[];
}

export interface File {
    id: number;
    main_id: string;
    secondary_id: string;
    content_type: string;
    tmdb_id: number;
    title: string;
    thumbnail: string;
    embed_url: string;
    season: any;
    episode: any;
    uploaded_at: string;
    created_at: string;
    stream: Stream;
    audio_info: AudioInfo;
}

export interface Stream {
    hls_streaming: string;
    duration: string;
    thumbnail_small: string;
    thumbnail_medium: string;
    download: Download[];
    preview_video: PreviewVideo[];
}

export interface Download {
    quality: string;
    url: string;
}

export interface PreviewVideo {
    url: string;
    frequency: number;
    height: number;
    width: number;
    count: number;
    tileWidth: number;
    tileHeight: number;
}

export interface AudioInfo {
    type: string;
    tracks: Track[];
}

export interface Track {
    language: string;
    file_code: string;
}
