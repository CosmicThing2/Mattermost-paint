import {PaintClient} from './client';
import {ensureStyles} from './editor/styles';
import {mountEditor} from './editor/ui';

interface Bootstrap {
    pluginBase: string;
    token: string;
    fileId: string;
    standalone: boolean;
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

    // The bearer token is in the address bar of whatever browser the mobile app
    // handed this page to. Keep it in memory and drop it from the URL so it does
    // not linger in history or get shared by a stray "copy link".
    if (window.history.replaceState && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
    }

    const client = new PaintClient(bootstrap.pluginBase, bootstrap.token);
    let sentPostId = '';

    const handle = mountEditor(root, {
        allowClose: false,

        load: async () => {
            const context = await client.context(bootstrap.fileId);

            return {
                title: context.file_name,
                subtitle: subtitleFor(context.channel_name, context.author_name),
                imageUrl: client.imageUrl(bootstrap.fileId),
                mimeType: context.mime_type,
                maxBytes: context.max_bytes,
                canPost: context.can_post,
            };
        },

        send: async (dataUrl, message) => {
            const result = await client.publish(bootstrap.fileId, dataUrl, message);
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
