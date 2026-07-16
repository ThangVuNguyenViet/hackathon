import { D1CheckpointSaver } from './persistence/d1CheckpointSaver.js';
import { D1Store, type D1DatabaseLike } from './persistence/d1Store.js';

let d1InitializationPromise: Promise<void> | undefined;

let d1InitializationDatabase: D1DatabaseLike | undefined;

const d1CheckpointSavers = new WeakMap<object, D1CheckpointSaver>();

export function workerCheckpointer(db: D1DatabaseLike): D1CheckpointSaver {
  let saver = d1CheckpointSavers.get(db as object);
  if (!saver) {
    saver = new D1CheckpointSaver(db);
    d1CheckpointSavers.set(db as object, saver);
  }
  return saver;
}

export function initializeWorkerStore(store: D1Store, db: D1DatabaseLike) {
  const shouldResetForTestDatabase =
    db.constructor?.name === "FakeD1Database" && d1InitializationDatabase !== db;
  if (!d1InitializationPromise || shouldResetForTestDatabase) {
    d1InitializationDatabase = db;
    d1InitializationPromise = store.initialize().catch((error) => {
      d1InitializationPromise = undefined;
      d1InitializationDatabase = undefined;
      throw error;
    });
  }
  return d1InitializationPromise;
}
