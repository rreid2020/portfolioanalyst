// Account types for the holdings editor. Same list, same order, as ACCOUNT_TYPES in portfolio_import.py
// (tests/test_api.py checks they match); the importer maps every broker label onto one of these.
export const ACCOUNT_TYPES = ["TFSA", "RRSP", "FHSA", "RRIF", "RESP", "RDSP", "LIRA", "Non-registered", "Other"] as const;
