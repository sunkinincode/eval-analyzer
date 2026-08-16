/* Small IndexedDB adapter shared by the UI. It has no knowledge of project data. */
(function attachStorageApi(global) {
  function createStore({ name, version, stores }) {
    let db = null;

    function open() {
      if (db) return Promise.resolve(db);
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = (event) => {
          const database = event.target.result;
          for (const store of stores) {
            if (!database.objectStoreNames.contains(store.name)) {
              database.createObjectStore(store.name, { keyPath: store.keyPath });
            }
          }
        };
        request.onsuccess = () => { db = request.result; resolve(db); };
        request.onerror = () => reject(request.error);
      });
    }

    async function put(storeName, value) {
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(value);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    }

    async function getAll(storeName) {
      const database = await open();
      return new Promise((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }

    async function get(storeName, key) {
      const database = await open();
      return new Promise((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    async function remove(storeName, key) {
      const database = await open();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).delete(key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    }

    return { get, getAll, put, remove };
  }

  global.EvalStorage = { createStore };
}(globalThis));
