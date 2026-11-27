/**
 * Wire the learning panel channel (`learning-web` / `panel`) to an agent
 * group, the same way scripts/init-cli-agent.ts wires the terminal channel.
 * Idempotent: rerunning is safe. Runs alongside the service (it only touches
 * the central DB, no adapters are started).
 *
 * Usage:
 *   pnpm exec tsx learning/scripts/init-web-channel.ts [--folder cli-with-lucas] [--display-name Lucas]
 */
import '../../src/channels/index.js';
import { resolveUnknownSenderPolicy, resolveWiringDefaults } from '../../src/channels/channel-defaults.js';
import { LEARNING_WEB_CHANNEL, LEARNING_WEB_PLATFORM_ID, LEARNING_WEB_USER_ID } from '../../src/channels/learning-web.js';
import { CENTRAL_DB_PATH } from '../../src/config.js';
import { getAgentGroupByFolder, getAllAgentGroups } from '../../src/db/agent-groups.js';
import { initDb } from '../../src/db/connection.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  getMessagingGroupAgentByPair,
  getMessagingGroupByPlatform,
} from '../../src/db/messaging-groups.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { upsertUser } from '../../src/modules/permissions/db/users.js';
import type { MessagingGroup } from '../../src/types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function main(): Promise<void> {
  const db = await initDb(CENTRAL_DB_PATH);
  await runMigrations(db);
  const now = new Date().toISOString();
  const folder = arg('--folder');
  const displayName = arg('--display-name') ?? 'Lucas';

  const groups = await getAllAgentGroups();
  const ag = folder ? await getAgentGroupByFolder(folder) : groups[0];
  if (!ag) {
    console.error(folder ? `No agent group with folder ${folder}` : 'No agent group exists yet. Run scripts/init-cli-agent.ts first.');
    process.exit(2);
  }

  await upsertUser({ id: LEARNING_WEB_USER_ID, kind: LEARNING_WEB_CHANNEL, display_name: displayName, created_at: now });

  let mg: MessagingGroup | undefined = await getMessagingGroupByPlatform(LEARNING_WEB_CHANNEL, LEARNING_WEB_PLATFORM_ID);
  if (!mg) {
    mg = {
      id: generateId('mg'),
      channel_type: LEARNING_WEB_CHANNEL,
      platform_id: LEARNING_WEB_PLATFORM_ID,
      name: 'Learning panel',
      is_group: 0,
      unknown_sender_policy: resolveUnknownSenderPolicy(LEARNING_WEB_CHANNEL, false),
      created_at: now,
    };
    await createMessagingGroup(mg);
    console.log(`Created messaging group: ${mg.id} (${LEARNING_WEB_CHANNEL}/${LEARNING_WEB_PLATFORM_ID})`);
  }

  const existing = await getMessagingGroupAgentByPair(mg.id, ag.id);
  if (!existing) {
    const engage = resolveWiringDefaults(LEARNING_WEB_CHANNEL, false, ag.name);
    await createMessagingGroupAgent({
      id: generateId('mga'),
      messaging_group_id: mg.id,
      agent_group_id: ag.id,
      engage_mode: engage.engage_mode,
      engage_pattern: engage.engage_pattern,
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'shared',
      priority: 0,
      created_at: now,
    });
    console.log(`Wired ${LEARNING_WEB_CHANNEL}: ${mg.id} -> ${ag.id} (${ag.name}, groups/${ag.folder})`);
  } else {
    console.log(`Wiring already exists: ${existing.id} (${ag.name}, groups/${ag.folder})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
