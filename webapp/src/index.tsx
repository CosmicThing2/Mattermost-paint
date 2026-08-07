import React from 'react';

import {PaintClient} from './client';
import {icon} from './editor/icons';
import {ensureStyles} from './editor/styles';
import {EditorHandle, mountEditor} from './editor/ui';

const PLUGIN_ID = 'com.cosmicthing.paint';
const PLUGIN_BASE = `/plugins/${PLUGIN_ID}`;

const client = new PaintClient(PLUGIN_BASE);

/** Whether the pencil button may take over the image preview. Resolved once at
 *  startup; the fallback keeps the plugin usable if the request fails. */
let previewOverrideEnabled = true;

interface FileInfoLike {
    id: string;
    name?: string;
    extension?: string;
    mime_type?: string;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

function isEditableImage(fileInfo?: FileInfoLike | null): boolean {
    if (!fileInfo || !fileInfo.id) {
        return false;
    }

    const mime = (fileInfo.mime_type || '').toLowerCase();
    if (mime) {
        // SVG is excluded on the server too; it is not something the canvas
        // should be asked to rasterise from an untrusted source.
        return IMAGE_EXTENSIONS.some((ext) => mime === `image/${ext}`);
    }

    return IMAGE_EXTENSIONS.includes((fileInfo.extension || '').toLowerCase());
}

// -- open/close plumbing ------------------------------------------------------
//
// The editor is mounted by a root component, but opened from menu items and
// buttons that have no path to it through React. A tiny subscription keeps the
// two ends connected without dragging in Redux.

type Listener = (fileId: string | null) => void;

const listeners = new Set<Listener>();

export function openEditor(fileId: string): void {
    if (fileId) {
        listeners.forEach((listener) => listener(fileId));
    }
}

function closeEditor(): void {
    listeners.forEach((listener) => listener(null));
}

// -- components ---------------------------------------------------------------

/** Mounted once at the app root; renders the editor overlay on demand. */
const EditorHost: React.FC = () => {
    const [fileId, setFileId] = React.useState<string | null>(null);
    const hostRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        const listener: Listener = (next) => setFileId(next);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    React.useEffect(() => {
        const host = hostRef.current;
        if (!fileId || !host) {
            return undefined;
        }

        // Stop the channel behind the overlay from scrolling under the editor.
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        let handle: EditorHandle | null = null;
        try {
            handle = mountEditor(host, {
                load: async () => {
                    const context = await client.context(fileId);

                    return {
                        title: context.file_name,
                        subtitle: context.channel_name,
                        imageUrl: await client.imageObjectUrl(fileId),
                        mimeType: context.mime_type,
                        maxBytes: context.max_bytes,
                        canPost: context.can_post,
                    };
                },
                send: async (dataUrl, message) => {
                    await client.publish(fileId, dataUrl, message);
                },
                close: closeEditor,
            });
        } catch {
            closeEditor();
        }

        return () => {
            document.body.style.overflow = previousOverflow;
            handle?.destroy();
        };
    }, [fileId]);

    if (!fileId) {
        return null;
    }

    return (
        <div className='mmpaint-overlay'>
            <div
                className='mmpaint-modal'
                ref={hostRef}
            />
        </div>
    );
};

/**
 * Replacement for Mattermost's image preview, adding the pencil button.
 *
 * It deliberately stays minimal — image, download, edit — because it is standing
 * in for a core component, and anything clever here is one more thing that can
 * look wrong after a Mattermost upgrade.
 */
const PaintPreview: React.FC<{fileInfo: FileInfoLike}> = ({fileInfo}) => (
    <div className='mmpaint-preview'>
        <img
            src={`/api/v4/files/${fileInfo.id}`}
            alt={fileInfo.name || 'Image'}
        />
        <div className='mmpaint-preview-actions'>
            <a
                className='mmpaint-fab'
                href={`/api/v4/files/${fileInfo.id}?download=1`}
                download={fileInfo.name}
                title='Download'
                aria-label='Download'
                dangerouslySetInnerHTML={{__html: icon('download')}}
            />
            <button
                type='button'
                className='mmpaint-fab'
                onClick={() => openEditor(fileInfo.id)}
                title='Annotate this photo'
            >
                <span dangerouslySetInnerHTML={{__html: icon('pen')}}/>
                {'Edit'}
            </button>
        </div>
    </div>
);

// -- registration -------------------------------------------------------------

interface Registry {
    registerRootComponent?: (component: React.ComponentType<any>) => void;
    registerFilePreviewComponent?: (
        override: (fileInfo: FileInfoLike, post?: unknown) => boolean,
        component: React.ComponentType<any>,
    ) => void;
    registerFileDropdownMenuAction?: (
        match: (fileInfo: FileInfoLike) => boolean,
        text: React.ReactNode,
        action: (fileInfo: FileInfoLike | string) => void,
    ) => void;
}

export default class PaintPlugin {
    initialize(registry: Registry): void {
        ensureStyles();

        registry.registerRootComponent?.(EditorHost);

        // Menu entry on each attachment. This is the fallback path, and it keeps
        // working even with the preview override switched off.
        registry.registerFileDropdownMenuAction?.(
            (fileInfo) => isEditableImage(fileInfo),
            'Annotate image',
            (fileInfo) => openEditor(typeof fileInfo === 'string' ? fileInfo : fileInfo?.id),
        );

        registry.registerFilePreviewComponent?.(
            (fileInfo) => previewOverrideEnabled && isEditableImage(fileInfo),
            PaintPreview,
        );

        // Settings arrive after registration; the override callback reads the
        // flag each time it runs, so a late answer still takes effect.
        client.settings().then((settings) => {
            previewOverrideEnabled = settings.preview_override;
        }).catch(() => {
            previewOverrideEnabled = true;
        });
    }

    uninitialize(): void {
        closeEditor();
    }
}

declare global {
    interface Window {
        registerPlugin?: (id: string, plugin: PaintPlugin) => void;
    }
}

window.registerPlugin?.(PLUGIN_ID, new PaintPlugin());
