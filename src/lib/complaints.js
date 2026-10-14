// Canonical complaint vocabulary. Citizens write it, officers triage it and
// reports count it, so all three read it from here and cannot drift apart.

export const COMPLAINT_TYPES = {
  overflowing_bin: 'Overflowing bin',
  missed_collection: 'Missed collection',
  other: 'Something else',
};

// Lifecycle: new -> reviewing -> assigned -> resolved, or rejected at any point.
// `tone` is a Pill tone, `citizen` is the line a resident sees.
export const COMPLAINT_STATUS = {
  new: { label: 'New', tone: 'info', citizen: 'We have received your report.' },
  reviewing: { label: 'Being reviewed', tone: 'warning', citizen: 'An officer is looking at your report.' },
  assigned: { label: 'Crew arranged', tone: 'info', citizen: 'A collection crew has been arranged.' },
  resolved: { label: 'Resolved', tone: 'ok', citizen: 'This has been dealt with. Thank you for telling us.' },
  rejected: { label: 'Not actioned', tone: 'muted', citizen: 'We could not act on this report.' },
};

export const COMPLAINT_STATUS_KEYS = Object.keys(COMPLAINT_STATUS);

export const typeLabel = (key) => COMPLAINT_TYPES[key] ?? 'Report';
export const statusMeta = (key) => COMPLAINT_STATUS[key] ?? COMPLAINT_STATUS.new;
