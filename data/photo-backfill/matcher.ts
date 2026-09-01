/**
 * Scoring + adjudication for photo-backfill candidates.
 *
 * Two independent gates decide a candidate's fate:
 *   1. License — only license-clear images are eligible at all
 *      (public-domain / CC0, or CC-BY / CC-BY-SA which need attribution).
 *      Anything NonCommercial (NC), NoDerivatives (ND), GFDL-only, or with an
 *      unknown/absent license is rejected outright.
 *   2. Match — name-token overlap + geographic proximity between the corpus
 *      place and the candidate photo.
 *
 * Conservatism is deliberate (task requirement): a candidate is only
 * `accepted` when BOTH a strong name signal AND a tight geographic match hold.
 * Anything plausible-but-ambiguous — geographically close but weak name, a
 * name hit with no verifiable coordinate (text search), moderate signals —
 * routes to `manual_review` rather than being guessed. Everything else is
 * dropped (not stored).
 *
 * THRESHOLDS BELOW ARE CHOSEN FOR THIS PILOT, not derived from a spec. They
 * are intentionally strict; tune after reviewing pilot output. Flagged in the
 * session report.
 */

import {
  extractTokens,
  substringMatch,
  tokenOverlap,
} from "../ingestion/sources/wikipedia.ts";
import type { CommonsCandidate } from "./commons.ts";

export type LicenseClass = "public_domain" | "attribution" | "reject";

export type MatchStatus = "accepted" | "manual_review" | "reject";

export type Adjudication = {
  status: MatchStatus;
  licenseClass: LicenseClass;
  nameScore: number;
  distanceM: number | null;
  confidence: number; // 0..1
  reason: string;
};

// Commons filename noise that should not count toward a name match.
const TITLE_NOISE = new Set([
  "file", "jpg", "jpeg", "png", "gif", "webp", "svg", "tif", "tiff",
  "panoramio", "unsplash", "img", "dsc", "photo", "image",
]);

/**
 * A place name too weak to anchor a substring match: empty, <=2 alphanumeric
 * chars, or purely numeric (OSM campgrounds are sometimes literally named "1",
 * "7", "15"). Without this guard, substringMatch("1", …) fires on any image
 * whose title/description contains that digit — a false accept. Weak names must
 * rely on real token overlap (which is ~0 for them), so they never auto-accept.
 */
export function weakPlaceName(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return n.length <= 2 || /^[0-9]+$/.test(n);
}

/** Strip "File:" prefix + extension, then token-overlap against the noise set removed. */
function candidateNameText(c: CommonsCandidate): string {
  const base = c.title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
  const tokens = extractTokens(base).filter((t) => !TITLE_NOISE.has(t));
  return tokens.join(" ");
}

export function classifyLicense(license: string | null): LicenseClass {
  if (!license) return "reject";
  const l = license.toLowerCase();
  // NonCommercial / NoDerivatives are not license-clear for our use.
  if (/\bnc\b|noncommercial|non-commercial/.test(l)) return "reject";
  if (/\bnd\b|noderiv|no-deriv/.test(l)) return "reject";
  if (l.includes("public domain") || l.includes("cc0") || l.includes("cc-zero"))
    return "public_domain";
  // CC-BY and CC-BY-SA (any version) — attribution required but usable.
  if (/cc[\s-]?by([\s-]?sa)?/.test(l)) return "attribution";
  // GFDL-only, "all rights reserved", or anything unrecognized → reject.
  return "reject";
}

/**
 * Score a Commons candidate against a corpus place.
 * `placeName` is the canonical name; distance comes from the candidate
 * (geosearch) — text-search candidates have distanceM === null.
 */
export function adjudicateCommons(
  placeName: string,
  candidate: CommonsCandidate,
): Adjudication {
  const licenseClass = classifyLicense(candidate.license);
  const candText = candidateNameText(candidate);
  const descText = candidate.imageDescription ?? "";
  const nameScore = Math.max(
    tokenOverlap(placeName, candText),
    tokenOverlap(placeName, descText),
  );
  const weak = weakPlaceName(placeName);
  const sub =
    !weak &&
    (substringMatch(placeName, candText) ||
      (descText.length > 0 && substringMatch(placeName, descText)));
  const distanceM = candidate.distanceM;

  const strongName = sub || nameScore >= 0.6;
  const closeGeo = distanceM != null && distanceM <= 500;
  const nearGeo = distanceM != null && distanceM <= 1500;

  // geographic + name confidence blend (rough, for ranking/adjudication display)
  const geoComp =
    distanceM == null ? 0 : Math.max(0, 1 - distanceM / 2000);
  const nameComp = Math.min(1, nameScore / 0.7 + (sub ? 0.3 : 0));
  const confidence =
    distanceM == null
      ? Math.min(1, 0.4 * nameComp) // text-only: capped, geo unverifiable
      : Math.min(1, 0.5 * nameComp + 0.5 * geoComp);

  if (licenseClass === "reject") {
    return {
      status: "reject",
      licenseClass,
      nameScore,
      distanceM,
      confidence,
      reason: `license not clear (${candidate.license ?? "none"})`,
    };
  }

  // Geo-anchored candidates (from geosearch).
  if (distanceM != null) {
    if (closeGeo && strongName) {
      return mk("accepted", `close (${Math.round(distanceM)}m) + name match (score=${nameScore.toFixed(2)}${sub ? ", substring" : ""})`);
    }
    if (nearGeo && (sub || nameScore >= 0.7)) {
      return mk("accepted", `near (${Math.round(distanceM)}m) + strong name (score=${nameScore.toFixed(2)}${sub ? ", substring" : ""})`);
    }
    if ((nearGeo && nameScore >= 0.3) || closeGeo || distanceM <= 300) {
      return mk("manual_review", `geographically plausible (${Math.round(distanceM)}m) but name weak/partial (score=${nameScore.toFixed(2)})`);
    }
    return mk("reject", `no meaningful name+geo signal (${Math.round(distanceM)}m, score=${nameScore.toFixed(2)})`);
  }

  // Text-search candidates: no coordinate → geo unverifiable → never auto-accept.
  if (sub || nameScore >= 0.6) {
    return mk("manual_review", `name match (score=${nameScore.toFixed(2)}${sub ? ", substring" : ""}) but location unverified (text search, no coordinate)`);
  }
  return mk("reject", `weak name and no coordinate (score=${nameScore.toFixed(2)})`);

  function mk(status: MatchStatus, reason: string): Adjudication {
    return { status, licenseClass, nameScore, distanceM, confidence, reason };
  }
}

/**
 * Adjudicate an NPS campground image match. NPS-credited images are public
 * domain; a credit that does not mention NPS names a third party whose rights
 * are unclear → manual_review regardless of match strength.
 */
export function adjudicateNps(
  nameScore: number,
  sub: boolean,
  distanceM: number,
  credit: string | null,
): Adjudication {
  const c = (credit ?? "").toLowerCase();
  const isNps =
    c.length === 0 || c.includes("nps") || c.includes("national park service");
  const licenseClass: LicenseClass = isNps ? "public_domain" : "attribution";
  const geoComp = Math.max(0, 1 - distanceM / 3000);
  const nameComp = Math.min(1, nameScore / 0.7 + (sub ? 0.3 : 0));
  const confidence = Math.min(1, 0.5 * nameComp + 0.5 * geoComp);
  const strongName = sub || nameScore >= 0.5;

  const mk = (status: MatchStatus, reason: string): Adjudication => ({
    status,
    licenseClass,
    nameScore,
    distanceM,
    confidence,
    reason,
  });

  if (!isNps) {
    return mk(
      "manual_review",
      `NPS-listed but image credited to a third party (${credit}); rights unclear`,
    );
  }
  if (strongName && distanceM <= 2000) {
    return mk(
      "accepted",
      `NPS campground, name match (score=${nameScore.toFixed(2)}${sub ? ", substring" : ""}) at ${Math.round(distanceM)}m, public domain`,
    );
  }
  if (distanceM <= 3000 && nameScore >= 0.25) {
    return mk(
      "manual_review",
      `NPS campground nearby (${Math.round(distanceM)}m) but name partial (score=${nameScore.toFixed(2)})`,
    );
  }
  return mk(
    "reject",
    `NPS campground too far / name mismatch (${Math.round(distanceM)}m, score=${nameScore.toFixed(2)})`,
  );
}

/**
 * Attribution string for storage/display. Public-domain images get null
 * (no attribution required); CC images get "Author / License".
 */
export function attributionString(
  licenseClass: LicenseClass,
  artist: string | null,
  license: string | null,
): string | null {
  if (licenseClass === "public_domain") return null;
  if (!artist) return license; // attribution required but author unknown → show license
  return license ? `${artist} / ${license}` : artist;
}
