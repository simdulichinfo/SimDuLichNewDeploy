# -*- coding: utf-8 -*-
"""
One-time ETL: convert the real Simplus SIM/eSIM price list (xlsx) into SQL
INSERT statements for categories / category_countries / products, matching
the schema in docs/superpowers/specs/2026-09-04-public-catalog-design.md.

Run: /c/msys64/ucrt64/bin/python.exe import_catalog.py
Outputs: catalog_real_data_import.sql (in this same scratchpad dir) + a
text report printed to stdout for manual sanity-checking before the SQL is
pasted into Supabase.
"""
import re
import sys
import openpyxl

SRC = r"C:\Users\sangh\Downloads\BÁO GIÁ SIM DLQT Tháng 06.DN.xlsx"
OUT_SQL = "catalog_real_data_import.sql"

# ---------------------------------------------------------------------------
# Vietnamese country/territory name -> ISO 3166-1 alpha-2 code.
# Built from every distinct name found in the "eSIM apn"/"SIM apn" sheets.
# Non-sovereign territories mapped to their common ISO code (Hong Kong=hk,
# Macao=mo, Guam=gu, Puerto Rico=pr, etc.) since that's what carriers/roaming
# actually key on, not political status.
# ---------------------------------------------------------------------------
VN_TO_ISO = {
    "Afghanistan": "af", "Ai Cập": "eg", "Albania": "al", "Algeria": "dz",
    "Andorra": "ad", "Anguilla": "ai", "Antigua và Barbuda": "ag",
    "Antilles thuộc Hà Lan": "an", "Argentina": "ar", "Armenia": "am",
    "Azerbaijan": "az", "Ba Lan": "pl", "Bahrain": "bh", "Bangladesh": "bd",
    "Barbados": "bb", "Belarus": "by", "Benin": "bj",
    "Bosnia và Herzegovina": "ba", "Brazil": "br", "Brunei": "bn",
    "Bulgaria": "bg", "Bắc Ireland": "gb", "Bắc Macedonia": "mk", "Bỉ": "be",
    "Bồ Đào Nha": "pt", "Campuchia": "kh", "Canada": "ca", "Chad": "td",
    "Chile": "cl", "Châu Âu": "eu", "Colombia": "co", "Costa Rica": "cr",
    "Croatia": "hr", "Các Tiểu vương quốc Ả Rập Thống nhất": "ae",
    "Cộng hòa Congo": "cg", "Cộng hòa Dominica": "do",
    "Cộng hòa Dân chủ Congo": "cd", "Cộng hòa Séc": "cz", "Dominica": "dm",
    "Ecuador": "ec", "El Salvador": "sv", "Estonia": "ee", "Ethiopia": "et",
    "Fiji": "fj", "Gabon": "ga", "Georgia": "ge", "Ghana": "gh",
    "Gibraltar": "gi", "Greenland": "gl", "Grenada": "gd",
    "Guadeloupe": "gp", "Guam": "gu", "Guernsey": "gg",
    "Guiana thuộc Pháp": "gf", "Hoa Kỳ": "us", "Hungary": "hu",
    "Hy Lạp": "gr", "Hà Lan": "nl", "Hàn Quốc": "kr", "Hồng Kông": "hk",
    "Iceland": "is", "Indonesia": "id", "Iraq": "iq", "Ireland": "ie",
    "Israel": "il", "Jamaica": "jm", "Jersey": "je", "Jordan": "jo",
    "Kazakhstan": "kz", "Kenya": "ke", "Kuwait": "kw", "Kyrgyzstan": "kg",
    "Latvia": "lv", "Liechtenstein": "li", "Lithuania": "lt",
    "Luxembourg": "lu", "Lào": "la", "Ma Cao": "mo", "Ma Rốc": "ma",
    "Madagascar": "mg", "Malawi": "mw", "Malaysia": "my", "Maldives": "mv",
    "Malta": "mt", "Martinique": "mq", "Mauritius": "mu", "Mexico": "mx",
    "Moldova": "md", "Monaco": "mc", "Montenegro": "me", "Montserrat": "ms",
    "Mozambique": "mz", "Mông Cổ": "mn", "Mỹ": "us", "Na Uy": "no",
    "Nam Phi": "za", "Nepal": "np", "New Zealand": "nz", "Nga": "ru",
    "Nhật Bản": "jp", "Niger": "ne", "Nigeria": "ng", "Oman": "om",
    "Pakistan": "pk", "Panama": "pa", "Paraguay": "py", "Peru": "pe",
    "Philippines": "ph", "Pháp": "fr", "Phần Lan": "fi",
    "Puerto Rico": "pr", "Qatar": "qa", "Quần đảo Bắc Mariana": "mp",
    "Quần đảo Cayman": "ky", "Quần đảo Faroe": "fo",
    "Quần đảo Turks và Caicos": "tc",
    "Quần đảo Virgin thuộc Anh": "vg", "Quần đảo Virgin thuộc Mỹ": "vi",
    "Romania": "ro", "Rwanda": "rw", "Réunion": "re",
    "Saint Barthélemy": "bl", "Saint Kitts và Nevis": "kn",
    "Saint Lucia": "lc", "Saint Martin": "mf",
    "Saint Vincent và Grenadines": "vc", "Saipan": "mp", "San Marino": "sm",
    "Scotland": "gb", "Senegal": "sn", "Serbia": "rs", "Singapore": "sg",
    "Slovakia": "sk", "Slovenia": "si", "Sri Lanka": "lk", "Síp": "cy",
    "Tajikistan": "tj", "Tanzania": "tz", "Thành Vatican": "va",
    "Thái Lan": "th", "Thổ Nhĩ Kỳ": "tr", "Thụy Sĩ": "ch",
    "Thụy Điển": "se", "Toàn cầu": "__worldwide__", "Trung Quốc": "cn",
    "Trung Quốc + Vương quốc Anh": "__multi_cn_gb__",
    "Trung Quốc đại lục": "cn", "Tunisia": "tn", "Tây Ban Nha": "es",
    "Uganda": "ug", "Ukraine": "ua", "Uruguay": "uy", "Uzbekistan": "uz",
    "Vatican": "va", "Việt Nam": "vn", "Vương quốc Anh": "gb",
    "Wales": "gb", "Zambia": "zm", "Áo": "at", "Úc": "au", "Ý": "it",
    "Đan Mạch": "dk", "Đài Loan": "tw", "Đảo Man": "im", "Đức": "de",
    "Ả Rập Xê Út": "sa", "Ấn Độ": "in",
}

# Region names (as they literally appear as the "Quốc gia/khu vực" value in
# the pricing sheets) that are themselves already a single, unambiguous
# country in English -- checked BEFORE falling back to the apn-sheet
# cross-reference, since these never appear as an apn group header verbatim.
DIRECT_REGION_TO_ISO = {
    "Japan": ["jp"], "Japan IIJ": ["jp"], "Australia": ["au"],
    "Philippines": ["ph"], "India": ["in"], "Russia": ["ru"],
    "Turkey": ["tr"], "Saudi Arabia": ["sa"], "UAE": ["ae"], "USA": ["us"],
    "USA A": ["us"], "Vietnam": ["vn"], "Taiwan": ["tw"], "Oman": ["om"],
    "Bangladesh": ["bd"], "Cambodia": ["kh"], "Laos": ["la"],
    "Sri Lanka": ["lk"], "Korea": ["kr"], "Thailand": ["th"],
    "Mongolia": ["mn"], "Maldives": ["mv"], "Mainland China": ["cn"],
    "Mainland China A": ["cn"], "Mainland China SG": ["cn"],
    "China, Hong Kong& Macao": ["cn", "hk", "mo"],
    "China, Macao": ["cn", "mo"], "Malaysia": ["my"],
    "Japan, Korea": ["jp", "kr"], "New Zealand, Australia": ["nz", "au"],
    "Singapore, Malaysia": ["sg", "my"],
    "China, Hong Kong, Macao, Taiwan": ["cn", "hk", "mo", "tw"],
    "Hong Kong, Macao": ["hk", "mo"],
    "USA, Canada, Mexico": ["us", "ca", "mx"],
    "Southeast Asia": ["sg", "my", "id", "th", "vn"],
}

# Region names with NO reliable country list anywhere in the source file --
# import the products/category, but leave category_countries empty rather
# than guess. Confirmed with the user before running this script.
NO_COUNTRY_MAPPING = {
    "APAC A", "APAC B", "Asia A", "Asia", "South America", "South America A",
    "Worldwide", "Multi-region TT", "Europe", "North America",
}

DATA_AMOUNT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(GB|MB)\b", re.IGNORECASE)


def slugify(text):
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-+", "-", text).strip("-")


def classify(title, description):
    text = f"{title} {description or ''}".lower()
    if "unlimited" in text or "không giới hạn" in text or "ayce" in text:
        package_type = "unlimited"
    elif re.search(r"/\s*(day|ngày)\b", text):
        package_type = "daily"
    else:
        package_type = "fixed"

    if package_type == "unlimited":
        capacity_bucket = "unlimited"
    else:
        m = DATA_AMOUNT_RE.search(title) or DATA_AMOUNT_RE.search(description or "")
        if not m:
            capacity_bucket = "other-fixed"
        else:
            value = float(m.group(1).replace(",", "."))
            unit = m.group(2).upper()
            if unit == "MB" and value <= 500:
                capacity_bucket = "under-1gb"
            elif unit == "GB" and value == 1:
                capacity_bucket = "1gb"
            elif unit == "GB" and value == 2:
                capacity_bucket = "2gb"
            else:
                capacity_bucket = "other-fixed"

    m = DATA_AMOUNT_RE.search(title) or DATA_AMOUNT_RE.search(description or "")
    if package_type == "unlimited":
        data_info = "Không giới hạn"
    elif m:
        amount = f"{m.group(1)}{m.group(2).upper()}"
        data_info = f"{amount}/ngày" if package_type == "daily" else amount
    else:
        data_info = title

    return package_type, capacity_bucket, data_info


def build_apn_country_groups(wb, sheet_name):
    """Return {normalized_group_name: [iso_code, ...]} from an apn sheet."""
    ws = wb[sheet_name]
    groups = {}
    current_key = None
    for row in ws.iter_rows(min_row=15, values_only=True):
        group_header, vn_country = row[0], row[1]
        if group_header:
            key = re.sub(r"[^a-z0-9]+", " ", group_header.strip().lower()).strip()
            current_key = key
            groups.setdefault(current_key, [])
        if current_key and vn_country:
            iso = VN_TO_ISO.get(vn_country.strip())
            if iso and not iso.startswith("__") and iso not in groups[current_key]:
                groups[current_key].append(iso)
    return groups


def resolve_countries(region, apn_groups_esim, apn_groups_sim):
    if region in DIRECT_REGION_TO_ISO:
        return list(DIRECT_REGION_TO_ISO[region])
    if region in NO_COUNTRY_MAPPING:
        return []
    key = re.sub(r"[^a-z0-9]+", " ", region.strip().lower()).strip()
    for groups in (apn_groups_esim, apn_groups_sim):
        if key in groups and groups[key]:
            return list(groups[key])
    return None  # genuinely unresolved -- script must stop and report this


def sql_str(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    apn_esim = build_apn_country_groups(wb, "eSIM apn")
    apn_sim = build_apn_country_groups(wb, "SIM apn")

    categories = {}  # name -> {"slug": ..., "countries": [...] or None}
    products = []    # list of dicts
    unresolved_regions = set()
    skipped_no_duration = []

    for sheet_name, sim_type in [("eSIM prices new", "esim"), ("Sim vật lý new", "physical")]:
        ws = wb[sheet_name]
        for row in ws.iter_rows(min_row=11, values_only=True):
            if row[0] is None:
                continue
            code, title, region, description = row[1], row[2], row[3], row[4]
            duration_days, price_import, price_buy = row[5], row[8], row[9]
            if not title or not region:
                continue
            if not isinstance(duration_days, (int, float)):
                m = re.search(r"(\d+)\s*(day|ngày)", f"{title} {description or ''}", re.IGNORECASE)
                duration_days = int(m.group(1)) if m else None
            if duration_days is None:
                skipped_no_duration.append((sheet_name, code, title))
                continue
            if price_buy is None or price_import is None:
                continue

            region = region.strip()
            if region not in categories:
                countries = resolve_countries(region, apn_esim, apn_sim)
                if countries is None:
                    unresolved_regions.add(region)
                    countries = []
                categories[region] = {"slug": slugify(region), "countries": countries}

            package_type, capacity_bucket, data_info = classify(title, description)
            base_slug = slugify(title)
            code_suffix = slugify(code) if code else ""
            slug = f"{base_slug}-{code_suffix}"[:200] if code_suffix else base_slug[:200]

            products.append({
                "category": region,
                "title": title.strip(),
                "slug": slug,
                "sim_type": sim_type,
                "price_buy": int(round(float(price_buy))),
                "price_import": int(round(float(price_import))),
                "data_info": data_info,
                "duration_days": int(duration_days),
                "package_type": package_type,
                "capacity_bucket": capacity_bucket,
                "api_package_code": code,
            })

    if unresolved_regions:
        print("STOPPED -- unresolved regions with no country mapping and not in NO_COUNTRY_MAPPING:")
        for r in sorted(unresolved_regions):
            print(" -", r)
        sys.exit(1)

    # De-duplicate product slugs (guarantee DB unique constraint holds)
    seen_slugs = {}
    for p in products:
        base = p["slug"]
        n = seen_slugs.get(base, 0)
        seen_slugs[base] = n + 1
        if n > 0:
            p["slug"] = f"{base}-{n}"

    cat_names_sorted = sorted(categories.keys())
    cat_id_by_name = {name: i + 1 for i, name in enumerate(cat_names_sorted)}

    lines = []
    lines.append("-- Auto-generated from BÁO GIÁ SIM DLQT Tháng 06.DN.xlsx — real Simplus price list.")
    lines.append("-- Run AFTER 0002_catalog.sql (schema) has already been applied.")
    lines.append("")
    lines.append("insert into public.categories (id, name, slug, image_url, status) values")
    lines.append(",\n".join(
        f"  ({cat_id_by_name[name]}, {sql_str(name)}, {sql_str(categories[name]['slug'])}, null, 'active')"
        for name in cat_names_sorted
    ) + ";")
    lines.append("select setval(pg_get_serial_sequence('public.categories', 'id'), (select max(id) from public.categories));")
    lines.append("")

    cc_rows = []
    for name in cat_names_sorted:
        for iso in categories[name]["countries"]:
            cc_rows.append(f"  ({cat_id_by_name[name]}, {sql_str(iso)})")
    if cc_rows:
        lines.append("insert into public.category_countries (category_id, country_code) values")
        lines.append(",\n".join(cc_rows) + ";")
        lines.append("")

    lines.append("insert into public.products (category_id, title, slug, sim_type, price_buy, price_import, data_info, duration_days, package_type, capacity_bucket, api_package_code, status) values")
    p_rows = []
    for p in products:
        p_rows.append(
            "  (" + ", ".join([
                str(cat_id_by_name[p["category"]]),
                sql_str(p["title"]), sql_str(p["slug"]), sql_str(p["sim_type"]),
                str(p["price_buy"]), str(p["price_import"]), sql_str(p["data_info"]),
                str(p["duration_days"]), sql_str(p["package_type"]), sql_str(p["capacity_bucket"]),
                sql_str(p["api_package_code"]), "'active'",
            ]) + ")"
        )
    lines.append(",\n".join(p_rows) + ";")

    with open(OUT_SQL, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    # ---- report ----
    print(f"Categories: {len(categories)}")
    with_countries = sum(1 for c in categories.values() if c["countries"])
    print(f"  with country mapping: {with_countries}")
    print(f"  WITHOUT country mapping (imported anyway, per user decision): {len(categories) - with_countries}")
    for name in cat_names_sorted:
        if not categories[name]["countries"]:
            print("   -", name)
    print(f"Products: {len(products)}")
    print(f"  skipped (no parseable duration): {len(skipped_no_duration)}")
    for s in skipped_no_duration[:15]:
        print("   -", s)
    from collections import Counter
    print("  package_type distribution:", Counter(p["package_type"] for p in products))
    print("  capacity_bucket distribution:", Counter(p["capacity_bucket"] for p in products))
    print("  sim_type distribution:", Counter(p["sim_type"] for p in products))
    print(f"Output written to: {OUT_SQL}")


if __name__ == "__main__":
    main()
