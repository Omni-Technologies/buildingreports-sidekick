// Seed data for the fake BuildingReports Device Editor (dev/fake-report).
// Plain objects keyed by BuildingReports' REAL dataIndex names (the same
// shape adapter.js's toPlainRecord()/rec.get() produce/consume) - NOT the
// semantic names the pure cleanup/* logic uses. Loaded as a plain script
// (non-module), so it just assigns window.FAKE_REPORT_FIXTURES.
//
// Covers, deliberately: today's date is baked in relative to
// `inspectiondate`/`installdate` below so expiration math stays meaningful
// without needing to edit this file every session - see `today()` at the
// bottom. Add a new record here whenever a new rule needs a scenario;
// nothing else in dev/fake-report/ needs to change.

(function () {
  function today() {
    return new Date();
  }
  function monthsAgo(n) {
    const d = today();
    d.setMonth(d.getMonth() - n);
    return d;
  }
  function yearsAgo(n) {
    const d = today();
    d.setFullYear(d.getFullYear() - n);
    return d;
  }

  let nextScan = 500001;
  function sn() {
    return nextScan++;
  }

  // Applies to every record unless overridden - matches RECORD_FIELDS /
  // BATTERY_FIELD_MAP / SERVICE_EXTRA_FIELD_MAP in adapter.js so nothing
  // reads `undefined` where it expects a string/boolean.
  function record(fields) {
    return Object.assign(
      {
        scannumber: sn(),
        devicetype: '',
        service: '',
        description: '',
        location: '',
        direction: '',
        comment: '',
        note: '',
        solution: '',
        modelnumber: '',
        floor: '',
        areasuite: '',
        manufacturer: '',
        passed: true,
        tested: true,
        // Battery attribute fields (raw dataIndex names)
        voltage: '',
        amps: '',
        pretestvoltage: '',
        posttestvoltage: '',
        velocity1door: '', // Min Ah
        velocity2door: '', // Tested Ah
        // Comms/Heat Detector attribute fields
        seconds: '', // Communicator Restore Time
        time: '', // Monitoring Confirmed Time
        simulated: false, // Heat Detector Restorable
        // Dates
        inspectiondate: monthsAgo(1),
        installdate: yearsAgo(1),
      },
      fields
    );
  }

  window.FAKE_REPORT_FIXTURES = [
    // --- Bare "Tested"/"Tested/Cleaned" placeholder (today's rule) ---
    record({ devicetype: 'Smoke Detector', service: 'Tested', passed: true, location: 'Hallway 1' }),
    record({ devicetype: 'Smoke Detector', service: 'Tested/Cleaned', passed: true, location: 'Hallway 2' }),
    record({ devicetype: 'Pull Station', service: 'Cleaned/Tested', passed: true, location: 'Exit A' }),
    record({ devicetype: 'Strobe', service: 'Tested / Cleaned', passed: true, location: 'Exit B' }),
    record({ devicetype: 'Duct Detector', service: 'Tested', passed: false, location: 'AHU-3' }), // Passed unchecked -> unsupportedField, never guessed

    // --- Ordinary Visual [& Functional] variations ---
    record({ devicetype: 'Horn/Strobe', service: 'visual and functional, passed', passed: true, location: 'Room 101' }),
    record({ devicetype: 'Speaker', service: 'Visual & Functional, Failed - no response', passed: false, location: 'Room 102' }),
    record({ devicetype: 'Control Panel', service: 'Visually & Functional, Passed', passed: true, location: 'FACP' }), // "Visually" typo tolerance
    record({ devicetype: 'Indicating Device', service: 'Failed, retested Passed', passed: true, location: 'Panel 2' }), // ambiguousConflict
    record({ devicetype: 'Damper Control', service: 'Tested By Others', passed: false, location: 'AHU-1' }), // customPreserved
    record({ devicetype: 'Elevator', service: '', passed: false, location: 'Elev 1' }), // blank
    record({ devicetype: 'Fire Barrier', service: 'Svc. By Hooper 2/25', passed: true, location: 'Stair 1' }), // unsupportedField

    // --- Untested device ("Not Tested"/"Barcoded" -> Bar Coded + Comment/Solution/Note) ---
    record({ devicetype: 'Damper Control', service: 'Not Tested', passed: false, location: 'AHU-1', note: 'door locked' }), // safeChange, Door Locked note
    record({ devicetype: 'Smoke Detector', service: 'Barcoded', passed: false, location: 'Conf Rm 2', comment: 'room occupied' }), // safeChange, Room Occupied note
    record({ devicetype: 'Duct Detector', service: 'not tested - inside RTU-4', passed: false, location: 'Roof' }), // safeChange, RTU note
    record({ devicetype: 'Heat Detector', service: 'Bar Code', passed: false, location: 'Elevator Shaft' }), // safeChange, elevator note
    record({ devicetype: 'Smoke Detector', service: 'Not Tested', passed: false, location: 'Storage' }), // needsReview (no reason given)
    record({ devicetype: 'Special Recall Thingy', service: 'visual and functional, passed', passed: true }), // unsupportedDeviceType

    // --- Heat Detector / One Hitter ---
    record({ devicetype: 'Heat Detector', service: 'visual and functional, passed', passed: true, location: 'Kitchen', note: '' }),
    record({ devicetype: 'Heat Detector', service: 'visual and functional, passed', passed: true, location: 'Boiler Rm', note: 'One Hitter', simulated: true }),
    record({ devicetype: 'Heat Detector', service: 'visual and functional, passed', passed: true, location: 'Garage', note: '1 hitter' }), // needsReview (ambiguous marker)

    // --- Battery (normal, unit-suffix, Left/Right pair, expired) ---
    record({
      devicetype: 'Battery', service: 'Visual & Functional, Passed', passed: true, location: 'FACP Batt',
      voltage: '12.00', amps: '26.00', pretestvoltage: '13.20', posttestvoltage: '12.90',
      velocity1door: '18.20', velocity2door: '24.50', modelnumber: '12V-26Ah', manufacturer: 'Power-Sonic',
      installdate: monthsAgo(6),
    }),
    record({
      devicetype: 'Battery', service: 'Visual & Functional, Passed', passed: true, location: 'NAC Batt',
      voltage: '12 V', amps: '75.0 AH', pretestvoltage: '13.10', posttestvoltage: '12.80', // unit-suffix tolerance
      velocity1door: '52.50', velocity2door: '70.00', modelnumber: '', manufacturer: 'Power Sonic',
      installdate: monthsAgo(3),
    }),
    record({
      devicetype: 'Battery', service: 'Visual & Functional, Passed', passed: true, location: 'Left Battery', direction: 'Left',
      voltage: '12.00', amps: '7.00', pretestvoltage: '13.00', posttestvoltage: '0.00',
      velocity1door: '4.90', velocity2door: '0.00', modelnumber: '12V-7Ah', manufacturer: 'Power-Sonic',
      installdate: yearsAgo(4), // expired + failed load test
    }),
    record({
      devicetype: 'Battery', service: 'Visual & Functional, Passed', passed: true, location: 'Right Battery', direction: 'Right',
      voltage: '12.00', amps: '7.00', pretestvoltage: '13.00', posttestvoltage: '12.60',
      velocity1door: '4.90', velocity2door: '6.80', modelnumber: '12V-7Ah', manufacturer: 'Power-Sonic',
      installdate: monthsAgo(2), // otherwise fine - should get paired with its failed Left counterpart
    }),

    // --- Communicator / Communication Line / Monitoring ---
    record({ devicetype: 'Communicator', service: 'restored @11:29am 5/1/25', seconds: '', passed: true }),
    record({ devicetype: 'Communication Line', service: 'restored @ 3:05 pm 5/1/25', passed: true }),
    record({ devicetype: 'Monitoring', service: '08/24/2026 10:48:51 AM', time: '', passed: true }),
    record({ devicetype: 'Monitoring', service: 'Na - no available devices', time: '', passed: true }),
    record({ devicetype: 'Monitoring', service: '', time: '', passed: false, note: 'Phone line disconnected by customer' }), // Passed unchecked + Note -> failure rule

    // --- Third-Party Serviced Devices ---
    record({ devicetype: 'Tamper Switch', service: 'Svc. By Hooper 2/25', passed: true, location: 'PIV-1', inspectiondate: monthsAgo(1) }), // alreadyCorrect
    record({ devicetype: 'Waterflow Switch', service: 'Jefferson Fire And Safety 7/26', passed: true, location: 'Riser 1', inspectiondate: monthsAgo(1) }), // abbreviates to "Jefferson F&S 7/26"
    record({ devicetype: 'Air Pressure Switch', service: 'A Very Extremely Long Fire Protection And Safety Company Name 3/26', passed: true, location: 'Dry Riser' }), // needsReview, needs manual fix
    record({ devicetype: 'Kitchen Hood', service: 'Svc. By Ansul 6/24', passed: true, location: 'Kitchen', inspectiondate: monthsAgo(1) }), // expired (>1yr) -> Comment/Solution/Note flags
    record({ devicetype: 'Fire Pump Phase Reversal', service: 'Svc. By Metro Fire Pump 1/26', passed: true, location: 'Pump Rm', inspectiondate: monthsAgo(1) }),

    // --- Failed devices, for Repaired/Fixed walkthrough testing ---
    record({
      devicetype: 'Smoke Detector', service: 'Visual & Functional, Failed - dirty chamber', passed: false, location: 'Rm 210',
      comment: 'Failed Test', solution: 'See Notes/Recommendations',
    }),
    record({
      devicetype: 'Battery', service: 'Visual & Functional, Failed - Date Expired', passed: false, location: 'Old Batt',
      voltage: '12.00', amps: '7.00', pretestvoltage: '13.00', posttestvoltage: '12.10',
      velocity1door: '4.90', velocity2door: '5.90', modelnumber: '12V-7Ah', manufacturer: 'Power-Sonic',
      installdate: yearsAgo(5),
      comment: 'Date Expired', solution: 'Replace Battery',
    }),
  ];
})();
