import { D1Store, type D1DatabaseLike } from './persistence/d1Store.js';

let d1InitializationPromise: Promise<void> | undefined;

let d1InitializationDatabase: D1DatabaseLike | undefined;

export function initializeWorkerStore(store: D1Store, db: D1DatabaseLike) {
  const shouldResetForTestDatabase =
    db.constructor?.name === 'FakeD1Database' &&
    d1InitializationDatabase !== db;
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
