class AlertManager {
  #config;
  #storage;
  #fetch;
  #state = new Map(); // key -> { status, since, value }

  constructor({ config, storage, fetch: fetchImpl = globalThis.fetch }) {
    this.#config = config;
    this.#storage = storage;
    this.#fetch = fetchImpl;
  }

  resolveRule(machine, guest) {
    const defaults = this.#config.defaults;
    const overrides = this.#config.overrides ?? [];
    const machineOnly = overrides.find((o) => o.machine === machine && o.guest == null);
    const guestMatch  = guest ? overrides.find((o) => o.machine === machine && o.guest === guest) : null;
    return { ...defaults, ...(machineOnly ?? {}), ...(guestMatch ?? {}) };
  }
}

module.exports = { AlertManager };
