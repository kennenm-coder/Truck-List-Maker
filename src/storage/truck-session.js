const DATABASE_NAME = "truck-list-maker";
const DATABASE_VERSION = 1;
const STORE_NAME = "active-session";
const ACTIVE_TRUCK_KEY = "active-truck";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser storage could not be opened."));
  });
}

function runTransaction(mode, operation) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error ?? new Error("Browser storage operation failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  }));
}

export function loadActiveTruck() {
  return runTransaction("readonly", (store) => store.get(ACTIVE_TRUCK_KEY));
}

export function saveActiveTruck(model) {
  return runTransaction("readwrite", (store) => store.put(model, ACTIVE_TRUCK_KEY));
}

export function clearActiveTruck() {
  return runTransaction("readwrite", (store) => store.delete(ACTIVE_TRUCK_KEY));
}

