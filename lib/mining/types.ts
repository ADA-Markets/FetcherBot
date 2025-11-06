export interface Challenge {
  challenge_id: string;
  difficulty: string;
  no_pre_mine: string;
  latest_submission: string;
  no_pre_mine_hour: string;
}

export interface ChallengeResponse {
  code: 'before' | 'active' | 'after';
  challenge?: Challenge;
  starts_at?: string;
}

export interface MiningStats {
  active: boolean;
  challengeId: string | null;
  solutionsFound: number;
  registeredAddresses: number;
  totalAddresses: number;
  hashRate: number;
  uptime: number;
  startTime: number | null;
  cpuUsage: number; // CPU usage percentage (0-100)
  addressesProcessedCurrentChallenge: number; // How many addresses have processed the current challenge
  solutionsThisHour: number; // Solutions found in current hour
  solutionsPreviousHour: number; // Solutions found in previous hour
  solutionsToday: number; // Solutions found today (since midnight)
  solutionsYesterday: number; // Solutions found yesterday
  workerThreads: number; // Number of parallel mining threads
}

export interface SolutionEvent {
  type: 'solution';
  address: string;
  challengeId: string;
  preimage: string;
  timestamp: string;
}

export interface StatusEvent {
  type: 'status';
  active: boolean;
  challengeId: string | null;
}

export interface StatsEvent {
  type: 'stats';
  stats: MiningStats;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export interface MiningStartEvent {
  type: 'mining_start';
  address: string;
  addressIndex: number;
  challengeId: string;
}

export interface HashProgressEvent {
  type: 'hash_progress';
  address: string;
  addressIndex: number;
  hashesComputed: number;
  totalHashes: number;
}

export interface SolutionSubmitEvent {
  type: 'solution_submit';
  address: string;
  addressIndex: number;
  challengeId: string;
  nonce: string;
  preimage: string;
}

export interface SolutionResultEvent {
  type: 'solution_result';
  address: string;
  addressIndex: number;
  preimage?: string;
  success: boolean;
  message: string;
}

export interface RegistrationProgressEvent {
  type: 'registration_progress';
  addressIndex: number;
  address: string;
  current: number;
  total: number;
  success: boolean;
  message?: string;
}

export interface WorkerStats {
  workerId: number;
  addressIndex: number;
  address: string;
  hashesComputed: number;
  hashRate: number;
  solutionsFound: number;
  startTime: number;
  lastUpdateTime: number;
  status: 'idle' | 'mining' | 'submitting' | 'completed';
  currentChallenge: string | null;
}

export interface WorkerUpdateEvent {
  type: 'worker_update';
  workerId: number;
  addressIndex: number;
  address: string;
  hashesComputed: number;
  hashRate: number;
  solutionsFound: number;
  status: 'idle' | 'mining' | 'submitting' | 'completed';
  currentChallenge: string | null;
}

export type MiningEvent = SolutionEvent | StatusEvent | StatsEvent | ErrorEvent | MiningStartEvent | HashProgressEvent | SolutionSubmitEvent | SolutionResultEvent | RegistrationProgressEvent | WorkerUpdateEvent;
