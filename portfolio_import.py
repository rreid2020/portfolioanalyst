"""Read holdings from broker CSV/Excel exports into Ticker/Shares/Avg Buy Price rows.

Brokers name their columns differently (Wealthsimple, Questrade, IBKR, a
hand-made sheet...), so columns are matched by normalized header aliases and
the header row is located automatically, skipping any preamble lines.
"""
import csv
import io
import re

import pandas as pd

COLUMNS = ["Ticker", "Shares", "Avg Buy Price", "Currency", "Account"]

# Canadian account types, in the order the holdings editor offers them.
ACCOUNT_TYPES = ["TFSA", "RRSP", "FHSA", "RRIF", "RESP", "RDSP", "LIRA", "Non-registered", "Other"]
# Normalized fragment -> account type, checked in order (rrsp before rsp, and so on).
ACCOUNT_KEYWORDS = [
    ("tfsa", "TFSA"), ("taxfree", "TFSA"), ("celi", "TFSA"),
    ("fhsa", "FHSA"), ("firsthome", "FHSA"), ("celiapp", "FHSA"),
    ("rrif", "RRIF"), ("retirementincome", "RRIF"), ("ferr", "RRIF"),
    ("resp", "RESP"), ("education", "RESP"),
    ("rdsp", "RDSP"), ("disability", "RDSP"),
    ("lira", "LIRA"), ("lockedin", "LIRA"), ("lif", "LIRA"), ("lrsp", "LIRA"),
    ("rrsp", "RRSP"), ("rsp", "RRSP"), ("retirementsavings", "RRSP"), ("reer", "RRSP"),
    ("nonregistered", "Non-registered"), ("nonreg", "Non-registered"), ("personal", "Non-registered"),
    ("individual", "Non-registered"), ("joint", "Non-registered"), ("cash", "Non-registered"),
    ("margin", "Non-registered"), ("taxable", "Non-registered"), ("corporate", "Non-registered"),
]

# Normalized header (lowercase, letters/digits only) -> field.
TICKER_ALIASES = {"symbol", "ticker", "tickersymbol", "stocksymbol", "securitysymbol", "code"}
SHARES_ALIASES = {"quantity", "shares", "qty", "units", "numberofshares", "sharesheld", "position", "openquantity"}
AVG_PRICE_ALIASES = {
    "avgbuyprice", "averagebuyprice", "avgprice", "averageprice", "avgcost",
    "averagecost", "averagecostpershare", "costpershare", "avgcostpershare",
    "averageentryprice", "purchaseprice", "buyprice", "costprice", "acbpershare",
}
# Total cost of the position; divided by shares when no per-share column exists.
BOOK_VALUE_PREFIXES = ("bookvalue", "bookcost", "costbasis", "totalcost", "acb")
EXCHANGE_ALIASES = {"exchange", "listingexchange", "market", "mic"}
# Account type columns first; an account name ("TFSA", "My RRSP") is the fallback.
ACCOUNT_ALIASES = {"accounttype", "registrationtype", "plantype", "accountclassification", "registration"}
ACCOUNT_NAME_ALIASES = {"accountname", "account", "accountnickname", "accountdescription"}

# yfinance suffixes for Canadian listings.
CANADIAN_SUFFIXES = {
    "TSX": ".TO", "TSE": ".TO", "XTSE": ".TO", "TOR": ".TO",
    "TSXV": ".V", "TSX-V": ".V", "XTSX": ".V", "CDNX": ".V", "VAN": ".V",
    "NEO": ".NE", "NEOE": ".NE", "XNEO": ".NE", "CBOE CANADA": ".NE", "CBOECA": ".NE",
    "CSE": ".CN", "XCNQ": ".CN", "CNSX": ".CN",
}

HEADER_SCAN_ROWS = 30


def _norm(value) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def _to_number(value):
    """Parse '1,234.50', '$12', '(3.5)', 'USD 10' etc. Returns None if not numeric."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    negative = text.startswith("(") and text.endswith(")")
    text = re.sub(r"[^0-9.\-]", "", text)
    if text in ("", "-", ".", "-."):
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return -number if negative else number


def normalize_account(value) -> str:
    """Map a broker's account label to one of ACCOUNT_TYPES, or "" when blank."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if text in ACCOUNT_TYPES:
        return text
    norm = _norm(text)
    for keyword, account in ACCOUNT_KEYWORDS:
        if keyword in norm:
            return account
    return "Other"


def _find_header_row(raw: pd.DataFrame):
    for i in range(min(HEADER_SCAN_ROWS, len(raw))):
        headers = {_norm(v) for v in raw.iloc[i].tolist()}
        if headers & TICKER_ALIASES and headers & SHARES_ALIASES:
            return i
    return None


def _pick_column(headers, aliases=None, prefixes=None):
    for col, norm in headers.items():
        if aliases and norm in aliases:
            return col
    for col, norm in headers.items():
        if prefixes and norm.startswith(prefixes):
            return col
    return None


def _pick_currency_column(headers, used_book_value: bool):
    for col, norm in headers.items():
        if norm == "currency":
            return col
    preferred = "book" if used_book_value else "price"
    for col, norm in headers.items():
        if "currency" in norm and preferred in norm:
            return col
    for col, norm in headers.items():
        if "currency" in norm:
            return col
    return None


def _yfinance_symbol(symbol: str, exchange: str) -> str:
    symbol = symbol.strip().upper()
    exchange = (exchange or "").strip().upper()
    suffix = CANADIAN_SUFFIXES.get(exchange)
    if suffix:
        if symbol.endswith(suffix):
            return symbol
        # e.g. RCI.B on TSX -> RCI-B.TO
        return symbol.replace(".", "-") + suffix
    if exchange and "." in symbol:
        # US class shares, e.g. BRK.B -> BRK-B
        return symbol.replace(".", "-")
    base, dot, share_class = symbol.rpartition(".")
    if dot and len(share_class) == 1 and share_class != "V":
        # No exchange given: a one-letter suffix is a share class, while
        # longer ones (.TO, .NE, .CN) and .V are yfinance exchange suffixes.
        return f"{base}-{share_class}"
    return symbol


def _read_raw_tables(filename: str, data: bytes):
    """Yield header-less DataFrames: one per CSV, one per Excel sheet."""
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm")):
        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None, dtype=object)
        yield from sheets.values()
        return
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    try:
        delimiter = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ","
    # Rows can have different lengths when the file starts with a preamble.
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    width = max((len(r) for r in rows), default=0)
    yield pd.DataFrame([r + [None] * (width - len(r)) for r in rows], dtype=object)


def read_holdings(filename: str, data: bytes):
    """Return (DataFrame with COLUMNS, list of warning strings)."""
    raw = header_row = None
    for table in _read_raw_tables(filename, data):
        header_row = _find_header_row(table)
        if header_row is not None:
            raw = table
            break
    if raw is None:
        raise ValueError(
            "Couldn't find a header row with a ticker/symbol column and a "
            "quantity/shares column."
        )

    table = raw.iloc[header_row + 1:].reset_index(drop=True)
    table.columns = [str(c).strip() for c in raw.iloc[header_row].tolist()]
    table = table.loc[:, ~pd.Index(table.columns).duplicated()]
    headers = {col: _norm(col) for col in table.columns}

    ticker_col = _pick_column(headers, TICKER_ALIASES)
    shares_col = _pick_column(headers, SHARES_ALIASES)
    avg_col = _pick_column(headers, AVG_PRICE_ALIASES)
    book_col = None if avg_col else _pick_column(headers, prefixes=BOOK_VALUE_PREFIXES)
    exchange_col = _pick_column(headers, EXCHANGE_ALIASES)
    account_col = _pick_column(headers, ACCOUNT_ALIASES)
    account_name_col = _pick_column(headers, ACCOUNT_NAME_ALIASES)
    currency_col = _pick_currency_column(headers, used_book_value=book_col is not None)

    warnings = []
    if not avg_col and not book_col:
        warnings.append("No average cost or book value column found; P/L can't be computed.")

    positions = {}
    skipped = 0
    for _, row in table.iterrows():
        symbol = row.get(ticker_col)
        if symbol is None or pd.isna(symbol) or not str(symbol).strip():
            continue
        shares = _to_number(row.get(shares_col))
        if shares is None or shares <= 0:
            skipped += 1
            continue
        exchange = row.get(exchange_col) if exchange_col else ""
        ticker = _yfinance_symbol(str(symbol), "" if pd.isna(exchange) else str(exchange))
        currency = row.get(currency_col) if currency_col else ""
        currency = "" if currency is None or pd.isna(currency) else str(currency).strip().upper()

        if avg_col:
            avg = _to_number(row.get(avg_col))
            cost = avg * shares if avg is not None else None
        elif book_col:
            cost = _to_number(row.get(book_col))
        else:
            cost = None

        account = normalize_account(row.get(account_col)) if account_col else ""
        if account in ("", "Other") and account_name_col:
            account = normalize_account(row.get(account_name_col)) or account

        # Lots of one security in the same account are combined; accounts stay apart.
        key = (ticker, currency, account)
        pos = positions.setdefault(key, {"shares": 0.0, "cost": 0.0, "has_cost": True})
        pos["shares"] += shares
        if cost is None:
            pos["has_cost"] = False
        else:
            pos["cost"] += cost

    if skipped:
        warnings.append(f"Skipped {skipped} row(s) without a positive quantity (cash, totals or short positions).")
    if not positions:
        raise ValueError("The file has a holdings header but no positions with a quantity.")

    rows = [
        {
            "Ticker": ticker,
            "Shares": round(pos["shares"], 6),
            "Avg Buy Price": round(pos["cost"] / pos["shares"], 4) if pos["has_cost"] else None,
            "Currency": currency,
            "Account": account,
        }
        for (ticker, currency, account), pos in positions.items()
    ]
    return pd.DataFrame(rows, columns=COLUMNS), warnings


def template_csv() -> bytes:
    return (
        "Ticker,Shares,Avg Buy Price,Currency,Account\n"
        "AAPL,10,150,USD,RRSP\n"
        "SHOP.TO,20,95.50,CAD,TFSA\n"
    ).encode()
