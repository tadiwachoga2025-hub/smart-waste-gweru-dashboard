// Generates database.rules.json (Firebase Realtime Database security rules).
// Run: node scripts/build-rules.mjs
//
// Why a generator: the rules language has no functions, so every role check is
// a long inline expression. Writing them once here keeps the matrix readable
// and keeps the rules in step with src/lib/rbac.js.
//
// The rules ARE the security boundary. Hiding a button in React is not.

import { writeFileSync } from 'node:fs';

const me = `root.child('users').child(auth.uid)`;
const active = `${me}.child('status').val() === 'active'`;
const roleIs = (...roles) =>
  `auth != null && ${active} && (${roles.map((r) => `${me}.child('role').val() === '${r}'`).join(' || ')})`;
// Administrators get an operational capability only when explicitly granted.
const granted = (perm) =>
  `(auth != null && ${active} && ${me}.child('role').val() === 'admin' && ${me}.child('grants').child('${perm}').val() === true)`;
const or = (...parts) => parts.map((p) => `(${p})`).join(' || ');

const admin = roleIs('admin');
const staff = roleIs('admin', 'officer', 'driver', 'technician');
const officer = roleIs('officer');
const driver = roleIs('driver');
const technician = roleIs('technician');
const citizen = roleIs('citizen');
const signedInActive = `auth != null && ${active}`;
const device = roleIs('device'); // service account for the ESP32 gateway; not a person, not in the UI

// Leaf-field validation helpers. Validation lives on the leaves (not the whole
// record) so partial updates, like a driver ticking one stop, are not rejected.
const oneOf = (...vals) => `[${vals.map((v) => `'${v}'`).join(',')}].contains(newData.val())`;
const text = (max) => `newData.isString() && newData.val().length <= ${max}`;
const coord = (lim) => `newData.isNumber() && newData.val() >= -${lim} && newData.val() <= ${lim}`;
// Server-stamped creation time: stops clients backdating records.
const stampedNow = `newData.child('createdAt').val() === now`;

const canDispatch = or(officer, granted('jobs.assign'));
const canReviewComplaints = or(officer, granted('complaints.review'));
const canManageSensors = or(technician, granted('sensors.manage'));

const rules = {
  rules: {
    '.read': false,
    '.write': false,

    users: {
      // Officers may list drivers only (to assign jobs), never residents or staff.
      '.read': or(admin, `${officer} && query.orderByChild === 'role' && query.equalTo === 'driver'`),
      '.indexOn': ['role', 'status'],
      $uid: {
        '.read': `auth != null && (auth.uid === $uid || ${admin} || (${officer} && data.child('role').val() === 'driver'))`,
        // Self-registration: a citizen profile for yourself, nothing more.
        // Administrators write any profile (create staff, change role, status, grants).
        '.write': or(
          admin,
          `auth != null && auth.uid === $uid && !data.exists() && newData.child('role').val() === 'citizen' && newData.child('status').val() === 'active' && !newData.child('grants').exists()`,
        ),
        // People may edit their own display name and phone, never role/status/grants.
        name: { '.write': `auth != null && auth.uid === $uid && ${active}` },
        phone: { '.write': `auth != null && auth.uid === $uid && ${active}` },
        '.validate': `newData.hasChildren(['name', 'email', 'role', 'status']) && ['admin','officer','driver','technician','citizen','device'].contains(newData.child('role').val()) && ['active','inactive'].contains(newData.child('status').val())`,
      },
    },

    // Live sensor records written by the ESP32 and engine.py.
    bins: {
      '.read': or(admin, officer, technician),
      $binId: {
        '.write': or(technician, device, granted('sensors.manage')),
      },
    },

    // Citizen-safe mirror (location + fill band only), written by engine.py.
    publicBins: {
      '.read': signedInActive,
    },

    logistics: {
      '.read': or(admin, officer),
    },

    // Collection jobs. Stops are a snapshot taken at assignment time, so drivers
    // never need to read /bins and only ever see their own work.
    jobs: {
      '.read': or(admin, officer, `auth != null && ${active} && ${me}.child('role').val() === 'driver' && query.orderByChild === 'driverUid' && query.equalTo === auth.uid`),
      '.indexOn': ['driverUid', 'status'],
      $jobId: {
        '.read': or(admin, officer, `${driver} && data.child('driverUid').val() === auth.uid`),
        '.write': canDispatch,
        priority: { '.validate': oneOf('normal', 'high', 'urgent') },
        title: { '.validate': text(120) },
        notes: { '.validate': text(500) },
        driverUid: { '.validate': 'newData.isString()' },
        // Drivers move their own job through its lifecycle, and tick stops.
        status: {
          '.write': `${driver} && data.parent().child('driverUid').val() === auth.uid && ((data.val() === 'assigned' && newData.val() === 'started') || (data.val() === 'started' && newData.val() === 'completed'))`,
          '.validate': oneOf('assigned', 'started', 'completed', 'cancelled'),
        },
        startedAt: { '.write': `${driver} && data.parent().child('driverUid').val() === auth.uid` },
        completedAt: { '.write': `${driver} && data.parent().child('driverUid').val() === auth.uid` },
        updatedAt: { '.write': `${driver} && data.parent().child('driverUid').val() === auth.uid` },
        stops: {
          $i: {
            done: { '.write': `${driver} && root.child('jobs').child($jobId).child('driverUid').val() === auth.uid && root.child('jobs').child($jobId).child('status').val() === 'started'` },
            doneAt: { '.write': `${driver} && root.child('jobs').child($jobId).child('driverUid').val() === auth.uid` },
          },
        },
      },
    },

    // Problems drivers report from the field (inaccessible bin, breakdown, ...).
    issues: {
      '.read': or(admin, officer, `auth != null && ${active} && ${me}.child('role').val() === 'driver' && query.orderByChild === 'driverUid' && query.equalTo === auth.uid`),
      '.indexOn': ['driverUid', 'status'],
      $issueId: {
        '.read': or(admin, officer, `${driver} && data.child('driverUid').val() === auth.uid`),
        '.write': or(
          canDispatch,
          `${driver} && !data.exists() && newData.child('driverUid').val() === auth.uid && newData.child('status').val() === 'open' && ${stampedNow} && !newData.child('resolvedBy').exists()`,
        ),
        type: { '.validate': oneOf('inaccessible-bin', 'breakdown', 'other') },
        status: { '.validate': oneOf('open', 'resolved') },
        note: { '.validate': text(1000) },
      },
    },

    // Citizen complaints. Citizens create and read only their own.
    complaints: {
      '.read': or(admin, officer, `auth != null && ${active} && ${me}.child('role').val() === 'citizen' && query.orderByChild === 'citizenUid' && query.equalTo === auth.uid`),
      '.indexOn': ['citizenUid', 'status'],
      $cid: {
        '.read': or(admin, officer, `${citizen} && data.child('citizenUid').val() === auth.uid`),
        '.write': or(
          canReviewComplaints,
          `${citizen} && !data.exists() && newData.child('citizenUid').val() === auth.uid && newData.child('status').val() === 'new' && ${stampedNow} && !newData.child('officerNote').exists() && !newData.child('reviewedBy').exists() && !newData.child('resolvedAt').exists() && !newData.child('jobId').exists()`,
        ),
        type: { '.validate': oneOf('overflowing_bin', 'missed_collection', 'other') },
        status: { '.validate': oneOf('new', 'reviewing', 'assigned', 'resolved', 'rejected') },
        note: { '.validate': text(2000) },
        officerNote: { '.validate': text(1000) },
        address: { '.validate': text(300) },
        lat: { '.validate': coord(90) },
        lng: { '.validate': coord(180) },
        // Photos are compressed data URLs (~150 KB); cap the stored size.
        photo: { '.validate': `newData.isString() && newData.val().length <= 260000 && newData.val().beginsWith('data:image/')` },
      },
    },

    // Truck registry, managed by whoever dispatches.
    trucks: {
      '.read': or(admin, officer),
      $truckId: {
        '.write': canDispatch,
        status: { '.validate': oneOf('available', 'in-service', 'maintenance') },
      },
    },

    // Sensor registry and maintenance history.
    devices: {
      '.read': or(admin, officer, technician),
      $deviceId: {
        '.write': canManageSensors,
        status: { '.validate': oneOf('active', 'faulty', 'replaced', 'retired') },
      },
    },
    maintenance: {
      '.read': or(admin, officer, technician),
      '.indexOn': ['deviceId', 'binId'],
      $mid: {
        // Technicians record work; officers may only flag a fault ("limited").
        '.write': or(
          canManageSensors,
          `${officer} && !data.exists() && newData.child('type').val() === 'report' && ${stampedNow}`,
        ),
        type: { '.validate': oneOf('inspection', 'repair', 'replacement', 'calibration', 'report') },
        note: { '.validate': text(1000) },
      },
    },

    // Append-only access log. Anyone signed in may add their own entries;
    // nobody can edit or delete; only administrators can read.
    audit: {
      '.read': admin,
      '.indexOn': ['at'],
      $aid: {
        // Append-only, and the actor can only describe themselves truthfully:
        // uid, role and name come from their own profile, time from the server.
        '.write': `${signedInActive} && !data.exists() && newData.child('actorUid').val() === auth.uid && newData.child('actorRole').val() === ${me}.child('role').val() && newData.child('at').val() === now`,
        '.validate': `newData.hasChildren(['at', 'actorUid', 'actorRole', 'action'])`,
        actorName: { '.validate': text(120) },
        action: { '.validate': `newData.isString() && newData.val().length <= 60` },
        target: { '.validate': text(200) },
        detail: { '.validate': text(500) },
        $other: { '.validate': false },
      },
    },
  },
};

writeFileSync(new URL('../database.rules.json', import.meta.url), `${JSON.stringify(rules, null, 2)}\n`);
console.log('Wrote database.rules.json');
