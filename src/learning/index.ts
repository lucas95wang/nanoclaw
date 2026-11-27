/**
 * Learning mode entry. src/index.ts calls startLearning() after the host is
 * fully up; it returns immediately when NANOCLAW_LEARNING is not '1', so the
 * official start path only pays one boolean check.
 */
import { log } from '../log.js';
import { startLearningServer, stopLearningServer } from './server.js';
import { isLearning, trace } from './trace.js';

export async function startLearning(): Promise<void> {
  if (!isLearning()) return;
  const port = Number(process.env.NANOCLAW_LEARNING_PORT) || undefined;
  const bound = await startLearningServer(port);
  trace({ stage: 0, event: 'host:learning-started', file: 'src/learning/index.ts', fn: 'startLearning', data: { port: bound, pid: process.pid } });
  log.info('Learning mode is ON: trace points active, panel served', { url: `http://127.0.0.1:${bound}/` });
}

export async function stopLearning(): Promise<void> {
  if (!isLearning()) return;
  await stopLearningServer();
}
