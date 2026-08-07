import {PaintClient} from './client';
import {ensureStyles} from './editor/styles';
import {mountEditor} from './editor/ui';

interface Bootstrap {
    pluginBase: string;
    standalone: boolean;
}

/**
 * Reads the token and file id the link was opened with.
 *
 * They live in the URL fragment, which the browser never sends to the server —
 * that is the whole point, since it keeps the token out of access logs. The
 * query string is still read as a fallback so that links handed out by earlier
 * versions of the plugin keep working until they expire.
 */
function readLinkParams(): {token: string; fileId: string} {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);

    const pick = (name: string) => fragment.get(name) || query.get(name) || '';

    return {
        token: pick('paint_token') || query.get('t') || '',
        fileId: pick('file_id'),
    };
}

/**
 * Entry point for the standalone editor page.
 *
 * This is what mobile users get: the official Mattermost apps cannot render
 * plugin interfaces, so `/paint` hands out a link to this page instead and the
 * app opens it in a browser.
 */
function start(): void {
    const root = document.getElementById('paint-root');
    if (!root) {
        return;
    }

    let bootstrap: Bootstrap;
    try {
        bootstrap = JSON.parse(root.dataset.bootstrap || '{}') as Bootstrap;
    } catch {
        root.textContent = 'This editor link is malformed. Run /paint again in Mattermost.';
        return;
    }

    ensureStyles();
    document.documentElement.classList.add('mmpaint-standalone');

    const {token, fileId} = readLinkParams();

    // The credential is in the address bar of whatever browser the mobile app
    // handed this page to. Keep it in memory and drop it from the URL so it does
    // not linger in history or get shared by a stray "copy link".
    if (window.history.replaceState && (window.location.hash || window.location.search)) {
        window.history.replaceState(null, '', window.location.pathname);
    }

    const client = new PaintClient(bootstrap.pluginBase, token);
    let sentPostId = '';

    const handle = mountEditor(root, {
        allowClose: false,

        load: async () => {
            if (!token && !fileId) {
                throw new Error(
                    'This editor link is incomplete — it may have been trimmed when it was opened. ' +
                    'Run /paint again in Mattermost to get a fresh one.',
                );
            }

            const context = await client.context(fileId);

            return {
                title: context.file_name,
                subtitle: subtitleFor(context.channel_name, context.author_name),
                imageUrl: await client.imageObjectUrl(context.file_id),
                mimeType: context.mime_type,
                maxBytes: context.max_bytes,
                canPost: context.can_post,
            };
        },

        send: async (dataUrl, message) => {
            const result = await client.publish(fileId, dataUrl, message);
            sentPostId = result.post_id;
        },

        close: () => {
            if (!sentPostId) {
                return;
            }

            handle.destroy();
            showDoneScreen(root, sentPostId);
        },
    });
}

function subtitleFor(channelName: string, authorName: string): string {
    if (channelName && authorName) {
        return `${channelName} · shared by @${authorName}`;
    }

    return channelName || (authorName ? `shared by @${authorName}` : '');
}

/**
 * After sending there is nowhere sensible to go back to — this page was opened
 * out of the mobile app, not navigated to — so confirm the send and offer a
 * permalink, which Mattermost redirects back into the app.
 */
function showDoneScreen(root: HTMLElement, postId: string): void {
    root.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'mmpaint-root';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.textAlign = 'center';
    wrapper.style.padding = '24px';

    const heading = document.createElement('h1');
    heading.textContent = 'Sent';
    heading.style.margin = '0 0 6px';
    heading.style.fontSize = '20px';

    const detail = document.createElement('p');
    detail.textContent = 'Your edited photo is in the thread.';
    detail.style.margin = '0 0 18px';
    detail.style.color = 'var(--mmpaint-muted)';

    const link = document.createElement('a');
    link.className = 'mmpaint-button mmpaint-button--primary';
    link.textContent = 'Back to the conversation';
    link.style.textDecoration = 'none';
    link.href = `/_redirect/pl/${encodeURIComponent(postId)}`;

    wrapper.appendChild(heading);
    wrapper.appendChild(detail);
    wrapper.appendChild(link);
    root.appendChild(wrapper);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}
