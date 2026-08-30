import type {
  FeedbackRecord,
  ExperienceFeedback,
  InformationFilter,
  InformationRun,
  KnowledgeByFilterId,
  LibraryEntry,
  PersonalProfile,
} from "../information/types.ts";
import {
  KNOWLEDGE_SCHEMA_VERSION,
  isNormalizedInformationFilter,
  migrateAlphaSnapshot,
  migrationWriteEntries,
  type AlphaSnapshotV2,
  type LegacyInformationFilter,
  type LegacyKnowledgeState,
} from "./alpha-migration.ts";

export type AlphaSnapshot = AlphaSnapshotV2;

type PersistedState = {
  filters: InformationFilter[];
  activeFilterId: string | null;
  profile: PersonalProfile;
  knowledgeByFilterId: KnowledgeByFilterId;
  knowledgeSchemaVersion: 2;
  library: LibraryEntry[];
  notes: Record<string, string>;
  feedback: FeedbackRecord[];
  experienceFeedback: ExperienceFeedback[];
  sessionId: string | null;
  lastRunByFilterId: Record<string, InformationRun>;
};

type AlphaKey = keyof PersistedState;

const databaseName = "signal-map-mobile-alpha";
const storeName = "state";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB unavailable"));
  });
}

async function readValue<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error || new Error(`Unable to read ${key}`));
    transaction.oncomplete = () => database.close();
  });
}

export async function setAlphaValue<K extends AlphaKey>(
  key: K,
  value: PersistedState[K],
) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value, key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error || new Error(`Unable to save ${key}`));
  });
}

async function writeMigration(snapshot: AlphaSnapshotV2) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    for (const [key, value] of migrationWriteEntries(snapshot)) store.put(value, key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error || new Error("Unable to migrate local data"));
  });
}

export async function loadAlphaSnapshot(): Promise<AlphaSnapshot> {
  const [filters, activeFilterId, profile, knowledgeByFilterId, knowledgeSchemaVersion, library, notes, feedback, experienceFeedback, sessionId, lastRunByFilterId, legacyKnowledge, legacyLastRun] =
    await Promise.all([
      readValue<Array<InformationFilter | LegacyInformationFilter>>("filters"),
      readValue<string | null>("activeFilterId"),
      readValue<PersonalProfile>("profile"),
      readValue<KnowledgeByFilterId>("knowledgeByFilterId"),
      readValue<number>("knowledgeSchemaVersion"),
      readValue<LibraryEntry[]>("library"),
      readValue<Record<string, string>>("notes"),
      readValue<FeedbackRecord[]>("feedback"),
      readValue<ExperienceFeedback[]>("experienceFeedback"),
      readValue<string | null>("sessionId"),
      readValue<Record<string, InformationRun>>("lastRunByFilterId"),
      readValue<LegacyKnowledgeState | null>("knowledge"),
      readValue<unknown>("lastRun"),
    ]);

  const filtersAreNormalized = (filters ?? []).every(isNormalizedInformationFilter);
  if (knowledgeSchemaVersion === KNOWLEDGE_SCHEMA_VERSION && profile && knowledgeByFilterId && filtersAreNormalized) {
    return {
      filters: (filters ?? []) as InformationFilter[],
      activeFilterId: activeFilterId ?? null,
      profile,
      knowledgeByFilterId,
      knowledgeSchemaVersion: KNOWLEDGE_SCHEMA_VERSION,
      library: library ?? [],
      notes: notes ?? {},
      feedback: feedback ?? [],
      experienceFeedback: experienceFeedback ?? [],
      sessionId: sessionId ?? null,
      lastRunByFilterId: lastRunByFilterId ?? {},
    };
  }

  const migrated = migrateAlphaSnapshot({
    filters: (filters ?? []) as LegacyInformationFilter[],
    activeFilterId: activeFilterId ?? null,
    knowledge: legacyKnowledge ?? null,
    library: library || [],
    notes: notes || {},
    feedback: feedback || [],
    experienceFeedback: experienceFeedback || [],
    sessionId: sessionId ?? null,
    lastRun: legacyLastRun ?? null,
  }, new Date().toISOString());
  await writeMigration(migrated);
  return migrated;
}

export async function clearAlphaData() {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error || new Error("Unable to clear local data"));
  });
}
