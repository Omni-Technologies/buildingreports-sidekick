// Word-abbreviation dictionary for Clean Up Service Entries' third-party
// serviced device rule (Air Pressure Switch / Tamper Switch / Waterflow
// Switch / Kitchen Hood - see src/cleanup/third-party-service-parser.js).
//
// These devices get serviced by outside companies, not Passed/Failed
// tested - their Service field normalizes to "Svc. By <Company> <M>/<YY>",
// which has to fit inside BuildingReports' 31-character Service limit.
// Only words in this dictionary get abbreviated; everything else (company/
// proper names) is left completely untouched - never guessed.
//
// Add new words here as real examples turn up. Keys are lowercase, matched
// case-insensitively with trailing punctuation stripped - see
// third-party-service-parser.js's abbreviate().
export const ABBREVIATION_DICTIONARY = {
  fire: 'F',
  protection: 'P',
  safety: 'S',
  alarm: 'A',
  security: 'Sec',
  systems: 'Sys',
  system: 'Sys',
  suppression: 'Sup',
  inspection: 'Insp',
  service: 'Svc',
  services: 'Svc',
  company: 'Co',
};
