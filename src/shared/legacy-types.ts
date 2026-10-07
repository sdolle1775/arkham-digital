export const BUILD_VERSION = '0.1.0';
export const SCHEMA_VERSION = 1;
export type Difficulty = 'easy' | 'standard' | 'hard' | 'expert';
export type PlayMode = 'hotseat' | 'separate';
export interface CardFace { id: 'front' | 'back'; name: string; text: string; imageUrl?: string; fallbackImageUrls?: string[]; }
export interface CardDefinition {
  code: string; name: string; type: string; subtype?: string; faction: string;
  quantity: number; position: number; encounterCode?: string; encounterPosition?: number;
  faces: CardFace[]; health?: number; sanity?: number; clues?: number;
  cluesPerInvestigator?: boolean;
  deckRequirements?: { size: number; signatures: string[]; basicWeaknesses: number };
  raw: Record<string, unknown>;
}
export interface Catalog { version: string; sourceRevision: string; fetchedAt: string; cards: Record<string, CardDefinition>; }
export type DeckSource = 'published' | 'shared';
export interface DeckRevision {
  id: string; libraryId: string; revision: number; source: DeckSource; sourceCode: string;
  name: string; investigatorCode: string; slots: Record<string, number>; sideSlots: Record<string, number>;
  sourceProblem?: string; unsupported: string[]; importedAt: string;
}
export interface CardInstance { id: string; code: string; face: 'front' | 'back'; exhausted: boolean; tokens: Record<string, number>; }
export interface InvestigatorState {
  id: string; seat: number; name: string; investigatorCode: string; deckRevisionId: string;
  resources: number; health: number; sanity: number; damage: number; horror: number;
  actions: number; clues: number; locationId: string; weaknessCodes: string[];
  deck: string[]; hand: string[]; openingSetAside: string[]; mulliganComplete: boolean;
  assets: string[]; threat: string[]; discard: string[];
}
export interface CampaignLog {
  entries: string; records: Record<string, { experience: number; physicalTrauma: number; mentalTrauma: number; notes: string }>;
  flags: string[];
}
export interface LocationState { cardId: string; x: number; y: number; connections: string[]; }
export interface PendingChoice { id: string; type: 'mulligan'; investigatorId: string; }
export interface GameState {
  schemaVersion: 1; sessionId: string; name: string; buildVersion: string; catalogVersion: string;
  revision: number; createdAt: string; phase: 'opening' | 'ready'; mode: PlayMode; difficulty: Difficulty;
  leadInvestigatorId: string; investigators: InvestigatorState[]; cards: Record<string, CardInstance>;
  scenario: { id: 'spreading_flames'; name: string; reference: string; acts: string[]; agendas: string[];
    encounterDeck: string[]; encounterDiscard: string[]; setAside: string[]; victory: string[];
    locations: LocationState[]; chaosBag: string[] };
  campaign: { id: 'brethren_of_ash'; name: string; scenarioNumber: 1; log: CampaignLog };
  rng: { algorithm: 'xoshiro128ss-v1'; state: [number, number, number, number] };
  pendingChoices: PendingChoice[]; effectQueue: unknown[];
}
export interface SetupOptions {
  sessionId: string; name: string; mode: PlayMode; difficulty: Difficulty; leadSeat: number;
  seats: { deckRevisionId: string; playerName: string }[]; logEntries?: string; seed?: number; createdAt?: string;
}
export type GameCommand =
  | { type: 'mulligan'; investigatorId: string; cardIds: string[] }
  | { type: 'campaign-log'; entries: string; records: CampaignLog['records'] };
export interface CommandEnvelope { commandId: string; expectedRevision: number; command: GameCommand; }
export interface Viewer { role: 'host' | 'player'; sessionId?: string; investigatorId?: string; }
export interface InvestigatorView extends Omit<InvestigatorState, 'deck' | 'hand' | 'openingSetAside' | 'weaknessCodes'> {
  deckCount: number; handCount: number; hand: string[]; canControl: boolean;
}
export interface SessionView extends Omit<GameState, 'rng' | 'investigators' | 'cards' | 'scenario' | 'effectQueue' | 'pendingChoices'> {
  investigators: InvestigatorView[]; cards: Record<string, CardInstance>; checkpointId: string;
  scenario: Omit<GameState['scenario'], 'encounterDeck' | 'setAside'> & { encounterDeckCount: number; actCount: number; agendaCount: number; setAside: string[] };
  pendingChoices: PendingChoice[];
}
export interface SessionSummary { id: string; name: string; phase: string; updatedAt: string; investigators: string[]; }
export interface HistoryEntry { id: string; parentId: string | null; branchId: string; label: string; createdAt: string; stateHash: string; revision: number; }
export interface SaveSummary { id: string; sessionId: string; checkpointId: string; name: string; createdAt: string; }
export interface AssetStatus { total: number; ready: number; failed: number; queued: number; downloading: boolean; failures: { key: string; error: string }[]; }
