// Sanitized, synthetic device records for tests - no real customer data.

export function makeRecord(overrides = {}) {
  return {
    scannumber: '1000001',
    devicetype: 'Smoke Detector',
    service: '',
    description: '',
    location: '',
    direction: '',
    floor: '',
    areasuite: '',
    comment: '',
    note: '',
    solution: '',
    modelnumber: 'TEST-MODEL',
    passed: true,
    tested: true,
    ...overrides,
  };
}

// Local "today minus N days" as a "YYYY-MM-DD" string - matches the shape
// src/site-adapters/buildingreports/adapter.js's toLocalDateOnlyString
// produces. Computed relative to the real clock (not a fixed literal) so
// the default fixture stays comfortably inside the 3-year expiration
// window no matter when the tests run.
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// A self-consistent, already-correct Battery record (semantic field names -
// see src/cleanup/rules/battery-cleanup.js). Useful as a baseline to
// override one field at a time in tests. Deliberately already-Passed (valid
// recent installDate, testedAh >= minAh, passed/service/comment/solution
// all matching the Passed outcome) so overriding one attribute field at a
// time doesn't also drag in an unrelated pass/fail outcome change.
export function makeBatteryRecord(overrides = {}) {
  return {
    scannumber: '2000001',
    devicetype: 'Battery',
    description: '',
    location: '',
    direction: '',
    floor: '',
    areasuite: '',
    modelNumber: '12V-7Ah',
    ratedVoltage: '12.00',
    amps: '7.00',
    preTest: '',
    postTest: '12.70',
    minAh: '4.55',
    testedAh: '9.30',
    installDate: daysAgo(30),
    passed: true,
    service: 'Visual & Functional, Passed',
    comment: '',
    solution: '',
    note: '',
    ...overrides,
  };
}
