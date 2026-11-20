// Preserve lifecycle/error evidence without repeating hundreds of full GPU snapshots per sample.
const fields = ['at', 'event', 'owner', 'id', 'generation', 'from', 'phase', 'rendererId', 'intentional', 'detail', 'error', 'lifecycle', 'capabilities', 'compatibility'];
export const compactGraphicsEvent = event => Object.fromEntries(fields.filter(key => event[key] !== undefined).map(key => [key, event[key]]));
export function graphicsEvidence(snapshot, includeEvents = false) {
  if (!snapshot) return snapshot;
  const { events, ...summary } = snapshot;
  return includeEvents ? { ...summary, events: events.map(compactGraphicsEvent) } : summary;
}
