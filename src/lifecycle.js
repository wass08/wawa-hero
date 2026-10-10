// An asynchronously acquired resource belongs only to the generation that requested it.
export function createResourceSlot() {
  let generation = 0, current = null;
  return {
    get current() { return current; },
    async acquire(factory, onStatus = () => {}) {
      const epoch = ++generation;
      current?.close(); current = null;
      let resource;
      try { resource = await factory((...args) => { if (epoch === generation) onStatus(...args); }); }
      catch (error) { if (epoch !== generation) return null; throw error; }
      if (epoch !== generation) { resource?.close(); return null; }
      current = resource; return resource;
    },
    close() { generation++; current?.close(); current = null; },
  };
}
