/**
 * Learning-panel channel — the local test entry for the learning panel.
 *
 * It is a real channel adapter: a message typed in the panel enters the host
 * through the same `ChannelSetup.onInbound` seam as every other channel (the
 * stamping point in src/index.ts), so it is routed, written to inbound.db,
 * answered in a container and delivered back through `deliver()` exactly like
 * a terminal or WhatsApp message. Outside learning mode the factory returns
 * null, which is how a channel without credentials stays dark: nothing is
 * registered, nothing runs.
 *
 * Transport is in-process: the learning server (src/learning/server.ts) calls
 * `sendFromPanel()` for inbound text and subscribes with `onPanelReply()` for
 * delivered replies.
 */
import { log } from '../log.js';
import { isLearning } from '../learning/trace.js';
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, OutboundMessage } from './adapter.js';
import { registerChannelAdapter } from './channel-registry.js';

export const LEARNING_WEB_CHANNEL = 'learning-web';
export const LEARNING_WEB_PLATFORM_ID = 'panel';
export const LEARNING_WEB_USER_ID = `${LEARNING_WEB_CHANNEL}:${LEARNING_WEB_PLATFORM_ID}`;

export const LEARNING_WEB_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'public' },
  group: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'public' },
  mentions: 'never',
};

export interface PanelReply {
  id: string;
  kind: string;
  text: string | null;
  content: unknown;
  files?: string[];
  at: string;
}

type ReplyListener = (reply: PanelReply) => void;

let setupConfig: ChannelSetup | null = null;
let connected = false;
const replyListeners = new Set<ReplyListener>();

export function onPanelReply(fn: ReplyListener): () => void {
  replyListeners.add(fn);
  return () => {
    replyListeners.delete(fn);
  };
}

export function panelChannelReady(): boolean {
  return connected && setupConfig !== null;
}

/**
 * Inject a message from the panel. Returns the platform message id, which is
 * the correlation key for every trace event of this message.
 */
export async function sendFromPanel(text: string, sender = 'Lucas'): Promise<string> {
  if (!setupConfig) throw new Error('learning-web channel is not set up (is NANOCLAW_LEARNING=1?)');
  const id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await setupConfig.onInbound(LEARNING_WEB_PLATFORM_ID, null, {
    id,
    kind: 'chat',
    timestamp: new Date().toISOString(),
    content: { text, sender, senderId: LEARNING_WEB_USER_ID },
  });
  return id;
}

function extractText(message: OutboundMessage): string | null {
  const content = message.content as Record<string, unknown> | string | undefined;
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
  return null;
}

function createAdapter(): ChannelAdapter | null {
  if (!isLearning()) return null;
  return {
    name: LEARNING_WEB_CHANNEL,
    channelType: LEARNING_WEB_CHANNEL,
    supportsThreads: false,
    defaults: LEARNING_WEB_DEFAULTS,
    async setup(config: ChannelSetup): Promise<void> {
      setupConfig = config;
      connected = true;
      log.info('learning-web channel ready (panel messages enter through onInbound)');
    },
    async teardown(): Promise<void> {
      connected = false;
      setupConfig = null;
    },
    isConnected(): boolean {
      return connected;
    },
    async deliver(platformId, _threadId, message: OutboundMessage): Promise<string | undefined> {
      if (platformId !== LEARNING_WEB_PLATFORM_ID) return undefined;
      const reply: PanelReply = {
        id: message.deliveryId ?? `reply-${Date.now()}`,
        kind: message.kind,
        text: extractText(message),
        content: message.content,
        files: message.files?.map((f) => f.filename),
        at: new Date().toISOString(),
      };
      for (const fn of replyListeners) {
        try {
          fn(reply);
          // eslint-disable-next-line no-catch-all/no-catch-all -- a listener must not fail delivery
        } catch (err) {
          log.warn('learning-web: reply listener threw', { err });
        }
      }
      return reply.id;
    },
  };
}

registerChannelAdapter(LEARNING_WEB_CHANNEL, { factory: createAdapter, defaults: LEARNING_WEB_DEFAULTS });
