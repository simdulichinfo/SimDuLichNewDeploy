import * as XLSX from 'xlsx';

export const VN_TO_ISO = {
  Afghanistan: 'af', 'Ai Cập': 'eg', Albania: 'al', Algeria: 'dz',
  Andorra: 'ad', Anguilla: 'ai', 'Antigua và Barbuda': 'ag',
  'Antilles thuộc Hà Lan': 'an', Argentina: 'ar', Armenia: 'am',
  Azerbaijan: 'az', 'Ba Lan': 'pl', Bahrain: 'bh', Bangladesh: 'bd',
  Barbados: 'bb', Belarus: 'by', Benin: 'bj',
  'Bosnia và Herzegovina': 'ba', Brazil: 'br', Brunei: 'bn',
  Bulgaria: 'bg', 'Bắc Ireland': 'gb', 'Bắc Macedonia': 'mk', Bỉ: 'be',
  'Bồ Đào Nha': 'pt', Campuchia: 'kh', Canada: 'ca', Chad: 'td',
  Chile: 'cl', 'Châu Âu': 'eu', Colombia: 'co', 'Costa Rica': 'cr',
  Croatia: 'hr', 'Các Tiểu vương quốc Ả Rập Thống nhất': 'ae',
  'Cộng hòa Congo': 'cg', 'Cộng hòa Dominica': 'do',
  'Cộng hòa Dân chủ Congo': 'cd', 'Cộng hòa Séc': 'cz', Dominica: 'dm',
  Ecuador: 'ec', 'El Salvador': 'sv', Estonia: 'ee', Ethiopia: 'et',
  Fiji: 'fj', Gabon: 'ga', Georgia: 'ge', Ghana: 'gh',
  Gibraltar: 'gi', Greenland: 'gl', Grenada: 'gd',
  Guadeloupe: 'gp', Guam: 'gu', Guernsey: 'gg',
  'Guiana thuộc Pháp': 'gf', 'Hoa Kỳ': 'us', Hungary: 'hu',
  'Hy Lạp': 'gr', 'Hà Lan': 'nl', 'Hàn Quốc': 'kr', 'Hồng Kông': 'hk',
  Iceland: 'is', Indonesia: 'id', Iraq: 'iq', Ireland: 'ie',
  Israel: 'il', Jamaica: 'jm', Jersey: 'je', Jordan: 'jo',
  Kazakhstan: 'kz', Kenya: 'ke', Kuwait: 'kw', Kyrgyzstan: 'kg',
  Latvia: 'lv', Liechtenstein: 'li', Lithuania: 'lt',
  Luxembourg: 'lu', Lào: 'la', 'Ma Cao': 'mo', 'Ma Rốc': 'ma',
  Madagascar: 'mg', Malawi: 'mw', Malaysia: 'my', Maldives: 'mv',
  Malta: 'mt', Martinique: 'mq', Mauritius: 'mu', Mexico: 'mx',
  Moldova: 'md', Monaco: 'mc', Montenegro: 'me', Montserrat: 'ms',
  Mozambique: 'mz', 'Mông Cổ': 'mn', Mỹ: 'us', 'Na Uy': 'no',
  'Nam Phi': 'za', Nepal: 'np', 'New Zealand': 'nz', Nga: 'ru',
  'Nhật Bản': 'jp', Niger: 'ne', Nigeria: 'ng', Oman: 'om',
  Pakistan: 'pk', Panama: 'pa', Paraguay: 'py', Peru: 'pe',
  Philippines: 'ph', Pháp: 'fr', 'Phần Lan': 'fi',
  'Puerto Rico': 'pr', Qatar: 'qa', 'Quần đảo Bắc Mariana': 'mp',
  'Quần đảo Cayman': 'ky', 'Quần đảo Faroe': 'fo',
  'Quần đảo Turks và Caicos': 'tc',
  'Quần đảo Virgin thuộc Anh': 'vg', 'Quần đảo Virgin thuộc Mỹ': 'vi',
  Romania: 'ro', Rwanda: 'rw', Réunion: 're',
  'Saint Barthélemy': 'bl', 'Saint Kitts và Nevis': 'kn',
  'Saint Lucia': 'lc', 'Saint Martin': 'mf',
  'Saint Vincent và Grenadines': 'vc', Saipan: 'mp', 'San Marino': 'sm',
  Scotland: 'gb', Senegal: 'sn', Serbia: 'rs', Singapore: 'sg',
  Slovakia: 'sk', Slovenia: 'si', 'Sri Lanka': 'lk', Síp: 'cy',
  Tajikistan: 'tj', Tanzania: 'tz', 'Thành Vatican': 'va',
  'Thái Lan': 'th', 'Thổ Nhĩ Kỳ': 'tr', 'Thụy Sĩ': 'ch',
  'Thụy Điển': 'se', 'Toàn cầu': '__worldwide__', 'Trung Quốc': 'cn',
  'Trung Quốc + Vương quốc Anh': '__multi_cn_gb__',
  'Trung Quốc đại lục': 'cn', Tunisia: 'tn', 'Tây Ban Nha': 'es',
  Uganda: 'ug', Ukraine: 'ua', Uruguay: 'uy', Uzbekistan: 'uz',
  Vatican: 'va', 'Việt Nam': 'vn', 'Vương quốc Anh': 'gb',
  Wales: 'gb', Zambia: 'zm', Áo: 'at', Úc: 'au', Ý: 'it',
  'Đan Mạch': 'dk', 'Đài Loan': 'tw', 'Đảo Man': 'im', Đức: 'de',
  'Ả Rập Xê Út': 'sa', 'Ấn Độ': 'in',
};

export const DIRECT_REGION_TO_ISO = {
  Japan: ['jp'], 'Japan IIJ': ['jp'], Australia: ['au'],
  Philippines: ['ph'], India: ['in'], Russia: ['ru'],
  Turkey: ['tr'], 'Saudi Arabia': ['sa'], UAE: ['ae'], USA: ['us'],
  'USA A': ['us'], Vietnam: ['vn'], Taiwan: ['tw'], Oman: ['om'],
  Bangladesh: ['bd'], Cambodia: ['kh'], Laos: ['la'],
  'Sri Lanka': ['lk'], Korea: ['kr'], Thailand: ['th'],
  Mongolia: ['mn'], Maldives: ['mv'], 'Mainland China': ['cn'],
  'Mainland China A': ['cn'], 'Mainland China SG': ['cn'],
  'China, Hong Kong& Macao': ['cn', 'hk', 'mo'],
  'China, Macao': ['cn', 'mo'], Malaysia: ['my'],
  'Japan, Korea': ['jp', 'kr'], 'New Zealand, Australia': ['nz', 'au'],
  'Singapore, Malaysia': ['sg', 'my'],
  'China, Hong Kong, Macao, Taiwan': ['cn', 'hk', 'mo', 'tw'],
  'Hong Kong, Macao': ['hk', 'mo'],
  'USA, Canada, Mexico': ['us', 'ca', 'mx'],
  'Southeast Asia': ['sg', 'my', 'id', 'th', 'vn'],
};

export const NO_COUNTRY_MAPPING = new Set([
  'APAC A', 'APAC B', 'Asia A', 'Asia', 'South America', 'South America A',
  'Worldwide', 'Multi-region TT', 'Europe', 'North America',
]);

const DATA_AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(GB|MB)\b/i;

export function slugify(text) {
  const lower = String(text).trim().toLowerCase();
  const dashed = lower.replace(/[^a-z0-9]+/g, '-');
  return dashed.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

export function classify(title, description) {
  const text = `${title} ${description || ''}`.toLowerCase();
  let packageType;
  if (text.includes('unlimited') || text.includes('không giới hạn') || text.includes('ayce')) {
    packageType = 'unlimited';
  } else if (/\/\s*(day|ngày)\b/.test(text)) {
    packageType = 'daily';
  } else {
    packageType = 'fixed';
  }

  const match = DATA_AMOUNT_RE.exec(title) || DATA_AMOUNT_RE.exec(description || '');
  let capacityBucket;
  if (packageType === 'unlimited') {
    capacityBucket = 'unlimited';
  } else if (!match) {
    capacityBucket = 'other-fixed';
  } else {
    const value = Number(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase();
    if (unit === 'MB' && value <= 500) capacityBucket = 'under-1gb';
    else if (unit === 'GB' && value === 1) capacityBucket = '1gb';
    else if (unit === 'GB' && value === 2) capacityBucket = '2gb';
    else capacityBucket = 'other-fixed';
  }

  let dataInfo;
  if (packageType === 'unlimited') {
    dataInfo = 'Không giới hạn';
  } else if (match) {
    const amount = `${match[1]}${match[2].toUpperCase()}`;
    dataInfo = packageType === 'daily' ? `${amount}/ngày` : amount;
  } else {
    dataInfo = title;
  }

  return { packageType, capacityBucket, dataInfo };
}

export function buildApnCountryGroups(rows2D) {
  const groups = {};
  let currentKey = null;
  for (let i = 14; i < rows2D.length; i++) {
    const row = rows2D[i];
    if (!row) continue;
    const groupHeader = row[0];
    const vnCountry = row[1];
    if (groupHeader) {
      currentKey = String(groupHeader).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (!groups[currentKey]) groups[currentKey] = [];
    }
    if (currentKey && vnCountry) {
      const iso = VN_TO_ISO[String(vnCountry).trim()];
      if (iso && !iso.startsWith('__') && !groups[currentKey].includes(iso)) {
        groups[currentKey].push(iso);
      }
    }
  }
  return groups;
}

export function resolveCountries(region, apnGroupsEsim, apnGroupsSim) {
  if (DIRECT_REGION_TO_ISO[region]) {
    return [...DIRECT_REGION_TO_ISO[region]];
  }
  if (NO_COUNTRY_MAPPING.has(region)) {
    return [];
  }
  const key = region.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const groups of [apnGroupsEsim, apnGroupsSim]) {
    if (groups[key] && groups[key].length) {
      return [...groups[key]];
    }
  }
  return null;
}

export function computeRowPricing(
  { simType, durationDays, priceImport, priceBuyFromFile },
  pricingOptions = {},
) {
  const esimMarkupPercent = pricingOptions.esimMarkupPercent ?? 30;
  const physicalFixedFee = pricingOptions.physicalFixedFee ?? 14000;
  const physicalNoDurationMultiplier = pricingOptions.physicalNoDurationMultiplier ?? 2;

  if (priceBuyFromFile != null && Number.isFinite(priceBuyFromFile) && priceBuyFromFile > 0) {
    return { priceBuy: Math.round(priceBuyFromFile), pricingRule: 'fromFile', warning: null };
  }
  if (simType === 'esim') {
    return {
      priceBuy: Math.round(priceImport * (1 + esimMarkupPercent / 100)),
      pricingRule: 'markupPercent',
      warning: null,
    };
  }
  if (durationDays != null) {
    return {
      priceBuy: Math.round(priceImport * durationDays + physicalFixedFee),
      pricingRule: 'daysPlusFee',
      warning: null,
    };
  }
  return {
    priceBuy: Math.round(priceImport * physicalNoDurationMultiplier),
    pricingRule: 'noDurationMultiplier',
    warning: `Không tìm thấy số ngày trong tên gói — áp dụng giá bán = giá nhập × ${physicalNoDurationMultiplier}.`,
  };
}

function sheetToRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
}

export function parseSmartImportWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const apnEsim = buildApnCountryGroups(sheetToRows(workbook, 'eSIM apn'));
  const apnSim = buildApnCountryGroups(sheetToRows(workbook, 'SIM apn'));

  const regionResolutions = new Map();
  const rows = [];

  for (const [sheetName, simType] of [['eSIM prices new', 'esim'], ['Sim vật lý new', 'physical']]) {
    const sheetRows = sheetToRows(workbook, sheetName);
    for (let i = 10; i < sheetRows.length; i++) {
      const r = sheetRows[i];
      if (!r || r[0] == null) continue;
      const code = r[1];
      const rawTitle = r[2];
      const region = r[3];
      const description = r[4];
      let durationDays = r[5];
      const priceImport = r[8];
      const priceBuyFromFile = r[9];

      if (!rawTitle || !region) {
        rows.push({
          sheet: sheetName,
          row: i + 1,
          code: code != null ? String(code) : null,
          rawTitle: rawTitle != null ? String(rawTitle).trim() : null,
          region: region != null ? String(region).trim() : null,
          description: description != null ? String(description) : '',
          durationDays: null,
          priceImport: priceImport != null ? Number(priceImport) : null,
          priceBuyFromFile: priceBuyFromFile != null ? Number(priceBuyFromFile) : null,
          simType,
          parseError: 'Thiếu tên gói hoặc quốc gia/khu vực.',
        });
        continue;
      }

      if (typeof durationDays !== 'number') {
        const m = /(\d+)\s*(day|ngày)/i.exec(`${rawTitle} ${description || ''}`);
        durationDays = m ? Number(m[1]) : null;
      }

      // A duration of 0 (or negative) is not a usable duration — treat it the
      // same as "no duration found" so pricing falls through to the
      // noDurationMultiplier rule (with its visible warning) instead of
      // daysPlusFee, which would silently zero out the real import cost
      // (priceImport * 0 + fixedFee).
      if (durationDays != null && durationDays <= 0) {
        durationDays = null;
      }

      const priceImportNum = priceImport != null ? Number(priceImport) : NaN;
      if (!Number.isFinite(priceImportNum) || priceImportNum <= 0) {
        rows.push({
          sheet: sheetName,
          row: i + 1,
          code: code != null ? String(code) : null,
          rawTitle: String(rawTitle).trim(),
          region: String(region).trim(),
          description: description != null ? String(description) : '',
          durationDays,
          priceImport: Number.isFinite(priceImportNum) ? priceImportNum : null,
          priceBuyFromFile: priceBuyFromFile != null ? Number(priceBuyFromFile) : null,
          simType,
          parseError: 'Thiếu giá nhập.',
        });
        continue;
      }

      const trimmedRegion = String(region).trim();
      if (!regionResolutions.has(trimmedRegion)) {
        regionResolutions.set(trimmedRegion, resolveCountries(trimmedRegion, apnEsim, apnSim));
      }

      rows.push({
        sheet: sheetName,
        row: i + 1,
        code: code != null ? String(code) : null,
        rawTitle: String(rawTitle).trim(),
        region: trimmedRegion,
        description: description != null ? String(description) : '',
        durationDays,
        priceImport: Number(priceImport),
        priceBuyFromFile: priceBuyFromFile != null ? Number(priceBuyFromFile) : null,
        simType,
      });
    }
  }

  return { rows, regionResolutions };
}
