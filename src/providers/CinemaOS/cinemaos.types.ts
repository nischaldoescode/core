export interface CinemaOSDownloadData {
    movieTitle: string;
    releaseYear: string;
    subtitleLink: string;
}

export interface CinemaOSDownloadResponse {
    data: CinemaOSDownloadData[];
}

export interface CinemaOSSource {
    url: string;
}

export interface CinemaOSEncryptedData {
    encrypted: string;
    cin: string;
    mao: string;
    salt: string;
}

export interface CinemaOSEncryptedResponse {
    data: CinemaOSEncryptedData;
}

export interface CinemaOSParsedSources {
    sources: Record<string, CinemaOSSource>;
}
