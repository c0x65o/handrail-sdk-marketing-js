import { requireThat } from "./store.js";

// ISO 3166-1 alpha-2 identities; names are always the provider's observation.
const codes = new Set(("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" "));
export const countryCode = (value: unknown): value is string => typeof value === "string" && codes.has(value);
export interface CountryPage { countries: { code: string; label: string }[]; after: string | null; }
export function countryPage(value: any): CountryPage {
  requireThat(value && !value.error && Array.isArray(value.data) && value.data.length <= 50, "country_search_invalid_response");
  const found = new Map<string, string>();
  for (const row of value.data) {
    requireThat(row && row.type === "country" && countryCode(row.key) && (row.country_code === undefined || row.country_code === row.key) && typeof row.name === "string" &&
      row.name.trim().length > 0 && row.name.length <= 200 && !/[\x00-\x1f\x7f]/.test(row.name), "country_search_invalid_identity");
    requireThat(!found.has(row.key) || found.get(row.key) === row.name, "country_search_conflicting_identity");
    found.set(row.key, row.name);
  }
  const more = !!value.paging?.next;
  const after = more ? value.paging?.cursors?.after : null;
  requireThat(!more || typeof after === "string" && /^[A-Za-z0-9_=-]{1,512}$/.test(after), "country_search_invalid_cursor");
  return { countries: [...found].map(([code, label]) => ({ code, label })), after };
}
