import type {
  FeedbackRecord,
  ExperienceFeedback,
  InformationFilter,
  InformationRun,
  KnowledgeState,
} from "../information/types.ts";
import type { ResearchSignal } from "../research/types.ts";

export type LibraryEntry = {
  event: ResearchSignal;
  notes: string;
  judgement: string;
  savedAt: string;
};

export type AlphaSnapshot = {
  filters: InformationFilter[];
  activeFilterId: string | null;
  knowledge: KnowledgeState | null;
  library: LibraryEntry[];
  notes: Record<string, string>;
  feedback: FeedbackRecord[];
  experienceFeedback: ExperienceFeedback[];
  sessionId: string | null;
  lastRun: InformationRun | null;
};

type AlphaKey = keyof AlphaSnapshot;

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

async function readValue<T>(key: AlphaKey): Promise<T | undefined> {
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
  value: AlphaSnapshot[K],
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

export async function loadAlphaSnapshot(): Promise<AlphaSnapshot> {
  const [filters, activeFilterId, knowledge, library, notes, feedback, experienceFeedback, sessionId, lastRun] =
    await Promise.all([
      readValue<InformationFilter[]>("filters"),
      readValue<string | null>("activeFilterId"),
      readValue<KnowledgeState | null>("knowledge"),
      readValue<LibraryEntry[]>("library"),
      readValue<Record<string, string>>("notes"),
      readValue<FeedbackRecord[]>("feedback"),
      readValue<ExperienceFeedback[]>("experienceFeedback"),
      readValue<string | null>("sessionId"),
      readValue<InformationRun | null>("lastRun"),
    ]);
  return {
    filters: filters || [],
    activeFilterId: activeFilterId || null,
    knowledge: knowledge || null,
    library: library || [],
    notes: notes || {},
    feedback: feedback || [],
    experienceFeedback: experienceFeedback || [],
    sessionId: sessionId || null,
    lastRun: lastRun || null,
  };
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
