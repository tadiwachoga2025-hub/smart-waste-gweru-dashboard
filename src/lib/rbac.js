// Role-based access control: one source of truth for who can do what.
//
// This file drives the UI (menus, screens, buttons). It is NOT the security
// boundary: database.rules.json enforces the same matrix on the server, built
// from scripts/build-rules.mjs. Keep the two in step.

export const ROLES = {
  admin: {
    label: 'System Administrator',
    short: 'Administrator',
    blurb: 'Manages accounts, roles and system settings.',
  },
  officer: {
    label: 'Waste Management Officer',
    short: 'Officer',
    blurb: 'Plans collections, assigns jobs and reviews reports.',
  },
  driver: {
    label: 'Waste Collection Driver',
    short: 'Driver',
    blurb: 'Runs the routes assigned to them.',
  },
  technician: {
    label: 'IoT Technician',
    short: 'Technician',
    blurb: 'Keeps bin sensors online and accurate.',
  },
  citizen: {
    label: 'Citizen / Resident',
    short: 'Citizen',
    blurb: 'Reports waste problems and tracks them.',
  },
};

export const ROLE_KEYS = Object.keys(ROLES);
// Roles an administrator can hand out to staff. Citizens self-register.
export const STAFF_ROLES = ['admin', 'officer', 'driver', 'technician'];

// Every capability in the access matrix. Scope is part of the name so a
// permission never means two things.
export const PERMISSIONS = {
  'users.manage': 'Manage users and roles',
  'bins.view': 'View the full bin monitoring dashboard',
  'bins.technical': 'View bins as a technical (sensor) view',
  'bins.public': 'View public bin status',
  'predictions.all': 'View all AI predictions',
  'predictions.assigned': 'View AI predictions for assigned jobs',
  'predictions.diagnostics': 'View AI predictions as diagnostics',
  'routes.generate': 'Generate optimised routes',
  'jobs.assign': 'Assign trucks and jobs',
  'jobs.update.all': 'Update the status of any collection',
  'jobs.update.assigned': 'Update the status of assigned jobs',
  'sensors.manage': 'Manage sensor maintenance',
  'sensors.limited': 'Flag sensor faults (limited maintenance)',
  'complaints.submit': 'Submit waste complaints',
  'complaints.review': 'Review waste complaints',
  'reports.all': 'View all operational reports',
  'reports.jobs': 'View reports for own jobs',
  'reports.devices': 'View device reports',
  'reports.own': 'View own reports',
  'audit.view': 'View the access log',
  'alerts.view': 'View bin-full email alerts and their history',
  'alerts.manage': 'Manage who receives bin-full emails, and the thresholds',
};

const ROLE_PERMISSIONS = {
  admin: ['users.manage', 'bins.view', 'predictions.all', 'reports.all', 'audit.view', 'alerts.view', 'alerts.manage'],
  officer: [
    'bins.view', 'predictions.all', 'routes.generate', 'jobs.assign', 'jobs.update.all',
    'sensors.limited', 'complaints.review', 'reports.all', 'alerts.view',
  ],
  driver: ['predictions.assigned', 'jobs.update.assigned', 'reports.jobs'],
  technician: ['bins.technical', 'predictions.diagnostics', 'sensors.manage', 'reports.devices'],
  citizen: ['bins.public', 'complaints.submit', 'reports.own'],
};

// The matrix footnote: an administrator may be given these, but only when
// another administrator assigns them explicitly. Never automatic.
export const GRANTABLE = [
  'routes.generate',
  'jobs.assign',
  'jobs.update.all',
  'sensors.manage',
  'complaints.submit',
  'complaints.review',
];

/** True when this profile may use the capability (role default or explicit grant). */
export function can(profile, permission) {
  if (!profile || profile.status !== 'active') return false;
  if (ROLE_PERMISSIONS[profile.role]?.includes(permission)) return true;
  return profile.role === 'admin' && GRANTABLE.includes(permission) && profile.grants?.[permission] === true;
}

export function canAny(profile, permissions) {
  return permissions.some((p) => can(profile, p));
}

/** Which live feeds a profile may subscribe to (the rules deny the rest). */
export function dataAccess(profile) {
  return {
    bins: canAny(profile, ['bins.view', 'bins.technical']),
    logistics: canAny(profile, ['bins.view']),
  };
}

// Every screen in the app. `view` is the screen key App.jsx renders; several
// nav entries can point at the same screen (Bins/Map are anchors in Overview).
// An entry shows when the profile has ANY of `needs`.
const ALL_NAV = [
  { key: 'overview', view: 'overview', label: 'Overview', needs: ['bins.view'] },
  { key: 'route', view: 'route', label: 'Route', needs: ['predictions.all'] },
  { key: 'bins', view: 'overview', label: 'Bins', scrollTo: 'pickups', needs: ['bins.view'] },
  { key: 'map', view: 'overview', label: 'Map', scrollTo: 'map', needs: ['bins.view'] },
  { key: 'dispatch', view: 'dispatch', label: 'Dispatch', needs: ['jobs.assign'] },
  { key: 'complaints', view: 'complaints', label: 'Complaints', needs: ['complaints.review'] },
  { key: 'jobs', view: 'jobs', label: 'My jobs', needs: ['jobs.update.assigned'] },
  { key: 'devices', view: 'devices', label: 'Devices', needs: ['sensors.manage', 'sensors.limited'] },
  { key: 'report', view: 'report', label: 'Report a problem', needs: ['complaints.submit'] },
  { key: 'reports', view: 'reports', label: 'Reports', needs: ['reports.all', 'reports.jobs', 'reports.devices', 'reports.own'] },
  { key: 'alerts', view: 'alerts', label: 'Alerts', needs: ['alerts.view'] },
  { key: 'users', view: 'users', label: 'Users', needs: ['users.manage'] },
  { key: 'audit', view: 'audit', label: 'Access log', needs: ['audit.view'] },
];

export function navFor(profile) {
  return ALL_NAV.filter((item) => canAny(profile, item.needs));
}

// Where each role lands after sign-in.
const HOME = { admin: 'overview', officer: 'overview', driver: 'jobs', technician: 'devices', citizen: 'report' };

export function homeFor(profile) {
  const nav = navFor(profile);
  const home = nav.find((n) => n.key === HOME[profile?.role]) ?? nav[0];
  return home ?? null;
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
