export interface PaintContext {
    file_id: string;
    file_name: string;
    width: number;
    height: number;
    mime_type: string;
    post_id: string;
    root_id: string;
    channel_id: string;
    channel_name: string;
    author_name: string;
    can_post: boolean;
    max_bytes: number;
}

export interface PaintSettings {
    preview_override: boolean;
    max_bytes: number;
}

export interface PublishResult {
    post_id: string;
}

/**
 * Talks to the plugin's own HTTP endpoints.
 *
 * There are two ways to authenticate, and which one applies depends on where the
 * editor is running. Inside the Mattermost webapp the session cookie is already
 * present, so requests ride on that. On the standalone page opened from a
 * `/paint` link there may be no cookie at all, so the bearer token from the link
 * is sent instead.
 */
export class PaintClient {
    private readonly base: string;
    private readonly token: string;

    constructor(base: string, token = '') {
        this.base = base.replace(/\/$/, '');
        this.token = token;
    }

    /** Image URL for an <img> tag. The token has to travel in the query string
     *  here, because an image request carries no custom headers. */
    imageUrl(fileId: string): string {
        const params = new URLSearchParams({file_id: fileId});
        if (this.token) {
            params.set('paint_token', this.token);
        }

        return `${this.base}/api/v1/image?${params.toString()}`;
    }

    async settings(): Promise<PaintSettings> {
        return this.request<PaintSettings>('GET', '/api/v1/settings');
    }

    async context(fileId: string): Promise<PaintContext> {
        const params = new URLSearchParams({file_id: fileId});
        return this.request<PaintContext>('GET', `/api/v1/context?${params.toString()}`);
    }

    async publish(fileId: string, dataUrl: string, message: string): Promise<PublishResult> {
        return this.request<PublishResult>('POST', '/api/v1/publish', {
            file_id: fileId,
            image: dataUrl,
            message,
        });
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const headers: Record<string, string> = {
            // Mattermost accepts this in place of a CSRF token for cookie-authed
            // plugin requests, and the server requires it on writes.
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (this.token) {
            headers['X-Paint-Token'] = this.token;
        }
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(this.base + path, {
            method,
            headers,
            credentials: 'same-origin',
            body: body === undefined ? undefined : JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(await errorMessage(response));
        }

        return response.json() as Promise<T>;
    }
}

async function errorMessage(response: Response): Promise<string> {
    try {
        const payload = await response.json();
        if (payload && typeof payload.error === 'string' && payload.error) {
            return payload.error;
        }
    } catch {
        // Fall through to the generic message below.
    }

    if (response.status === 401 || response.status === 403) {
        return 'Your session has expired. Sign in to Mattermost and try again.';
    }
    if (response.status === 413) {
        return 'That edit was too large to send.';
    }

    return `Mattermost returned an error (${response.status}).`;
}
