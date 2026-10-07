import type * as Legacy from './legacy-types.js';
export const BUILD_VERSION = '0.2.0';
export const SCHEMA_VERSION = 2;
export const SCRIPT_VERSION = 'pilot-1';
export type Difficulty = Legacy.Difficulty;
export type PlayMode = Legacy.PlayMode;
export type CardFace = Legacy.CardFace;
export type CardDefinition = Legacy.CardDefinition;
export interface Catalog extends Legacy.Catalog { rules?: RulesIdentity; }
export type DeckSource = Legacy.DeckSource;
export interface RulesIdentity { id: string; tabooId: number; tabooDate: string; tabooUpdated: string; tabooHash: string; catalogVersion: string; scriptVersion: string; }
export interface DeckRevision extends Legacy.DeckRevision {
  rules?: RulesIdentity; sourceSlots?: Record<string, number>; sourceSideSlots?: Record<string, number>;
  sourceInvestigatorCode?: string; sourceTabooId?: number; purchaseXp?: number;
}
export interface CardInstance extends Legacy.CardInstance { owner: string; controller: string; bearer?: string; attachedTo?: string; }
export type InvestigatorState = Omit<Legacy.InvestigatorState, 'deck'|'hand'|'openingSetAside'|'assets'|'threat'|'discard'> & { cardId: string; eliminated: boolean; turnEnded: boolean };
export type CampaignLog = Legacy.CampaignLog;
export type LocationState = Legacy.LocationState;
export type ZoneKind = 'deck'|'hand'|'openingSetAside'|'assets'|'threat'|'discard'|'identity'|'reference'|'acts'|'agendas'|'encounterDeck'|'encounterDiscard'|'setAside'|'victory'|'removed'|'locations'|'enemies'|'attachments'|'resolving'|'committed'|'search';
export interface Zone { id: string; kind: ZoneKind; owner: string; visibility: 'public'|'owner'|'hidden'; cards: string[]; }
export type Skill = 'willpower'|'intellect'|'combat'|'agility';
export interface ChoiceOption { id: string; label: string; cardId?: string; }
export interface PendingChoice { id: string; type: 'mulligan'|'decision'; investigatorId: string; prompt?: string; options?: ChoiceOption[]; min?: number; max?: number; private?: boolean; context?: Record<string, string>; }
export interface Effect { type: string; actor?: string; source?: string; target?: string; amount?: number; data?: Record<string, any>; }
export interface ResolutionFrame extends Effect { id: string; step: number; paidCosts?: { resources: number; actions: number }; }
export interface SkillTest { id: string; actor: string; source?: string; target?: string; skill: Skill; difficulty: number; bonus: number; damage: number; action: string; stage: number; committed: string[]; tokens: string[]; tokenModifier: number; success?: boolean; margin?: number; elderSign?: boolean; peril?: boolean; participants: string[]; }
export interface Modifier { id: string; source: string; target: string; stat: string; amount: number; expires: 'test'|'phase'|'round'|'game'; }
export interface AbilityDefinition { id: string; cardCode: string; timing: 'action'|'fast'|'reaction'|'forced'|'constant'|'revelation'; label: string; }
export interface AllowedAction { id: string; investigatorId: string; label: string; source?: string; target?: string; }
export interface GameState {
  schemaVersion: 2; sessionId: string; name: string; buildVersion: string; catalogVersion: string; rules: RulesIdentity;
  revision: number; createdAt: string; phase: 'opening'|'ready'|'playing'|'ended'|'unsupported'; mode: PlayMode; difficulty: Difficulty;
  leadInvestigatorId: string; investigators: InvestigatorState[]; cards: Record<string, CardInstance>; zones: Record<string, Zone>;
  scenario: { id: 'spreading_flames'; name: 'Spreading Flames'; locations: LocationState[]; chaosBag: string[] };
  campaign: Legacy.GameState['campaign']; rng: Legacy.GameState['rng']; pendingChoices: PendingChoice[];
  setup: { order: string[]; completed: string[] }; resolutionStack: ResolutionFrame[]; queuedTests: SkillTest[]; test: SkillTest|null;
  engine: { pilot: boolean; round: number; phase: 'investigation'|'enemy'|'upkeep'|'mythos'; activeInvestigatorId: string|null; nextId: number; actionDepth: number; log: string[]; blockedReason?: string; limits: Record<string, number>; attacked: Record<string, number>; modifiers: Modifier[]; experiencePenalty: Record<string,number>; outcomes: { kind: string; value: string }[] };
}
export type SetupOptions = Legacy.SetupOptions;
export type GameCommand = Legacy.GameCommand | { type: 'action'; investigatorId: string; actionId: string } | { type: 'choose'; investigatorId: string; choiceId: string; optionIds: string[] } | { type: 'pass'; investigatorId: string; choiceId: string };
export interface CommandEnvelope { commandId: string; expectedRevision: number; command: GameCommand; }
export type Viewer = Legacy.Viewer;
export interface InvestigatorView extends InvestigatorState { deckCount: number; handCount: number; hand: string[]; assets: string[]; threat: string[]; discard: string[]; canControl: boolean; }
export interface SessionView extends Omit<GameState, 'rng'|'investigators'|'cards'|'zones'|'scenario'|'resolutionStack'|'queuedTests'|'test'|'engine'|'pendingChoices'> {
  investigators: InvestigatorView[]; cards: Record<string, CardInstance>; checkpointId: string;
  scenario: Omit<Legacy.GameState['scenario'], 'encounterDeck'> & { encounterDeckCount: number; actCount: number; agendaCount: number; removed: string[]; enemies: string[] };
  pendingChoices: PendingChoice[]; allowedActions: AllowedAction[]; engine: Pick<GameState['engine'],'pilot'|'round'|'phase'|'activeInvestigatorId'|'log'|'blockedReason'>;
  test: Pick<SkillTest,'actor'|'skill'|'difficulty'|'tokens'|'stage'|'success'|'margin'>|null;
}
export type SessionSummary = Legacy.SessionSummary;
export type HistoryEntry = Legacy.HistoryEntry;
export type SaveSummary = Legacy.SaveSummary;
export interface AssetStatus extends Legacy.AssetStatus { phase: 'checking'|'downloading'|'error'|'ready'; installed: boolean; checked: number; }
