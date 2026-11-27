export type Side = 'host' | 'container' | 'panel';

export interface TraceEvent {
  seq: number;
  ts: string;
  tMs: number;
  side: Side;
  stage: number;
  event: string;
  msgId: string | null;
  sessionId: string | null;
  agentGroupId: string | null;
  file: string;
  fn: string;
  data: Record<string, unknown>;
}

export interface PanelReply {
  id: string;
  kind: string;
  text: string | null;
  content: unknown;
  files?: string[];
  at: string;
}

export interface NodeDef {
  id: string;
  title: string;
  stage?: number;
  feature: string;
  group?: 'side' | 'base';
  uses?: string[];
  file?: string;
  fn?: string;
}

export interface NodesFile {
  stages: NodeDef[];
  mechanisms: NodeDef[];
  levels: Level[];
}

export type Level = '未接触' | '模糊' | '理解' | '能讲给别人听';

export interface MasteryRow {
  id: string;
  title: string;
  level: Level;
  updated: string;
  note: string;
}

export interface Profile {
  updated: string;
  mastery: MasteryRow[];
  wrongGuesses: string[];
  repeatedQuestions: Record<string, number>;
  exams: string[];
  reviewDue: Record<string, string>;
  sessions: string[];
}

export interface ProfileSummary {
  lastSession: string | null;
  suggestion: string;
  counts: Record<Level, number>;
}

export interface StateSnapshot {
  learning: boolean;
  port: number;
  startedAt: string;
  channels: Array<{ name: string; channelType: string; connected: boolean; supportsThreads: boolean }>;
  panelChannelReady: boolean;
  agentGroups: Array<{ id: string; name: string; folder: string }>;
  sessions: Array<{ id: string; agentGroupId: string; messagingGroupId: string | null; threadId: string | null; containerStatus: string; lastActive: string | null }>;
  faults: string[];
  faultNames: readonly string[];
  claudeCli: { available: boolean; loggedIn: boolean; detail: string };
  unavailable: Record<string, string>;
}

export interface TraceListItem {
  msgId: string;
  mtimeMs: number;
  first: TraceEvent | null;
}

export type Mode = 'live' | 'step' | 'replay';
