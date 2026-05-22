#!/usr/bin/env node
// Runs as `npm run postbuild` after `next build`. Reads the build ID
// Next.js writes to `.next/BUILD_ID` and emits `public/sw-version.js`,
// which `public/sw.js` pulls in via importScripts at startup.
//
// The build ID changes per build, so each deploy gets its own
// app-shell-html-<id> and app-shell-static-<id> caches; the SW's
// activate handler evicts caches with mismatched IDs. Mapbox caches
// (mb-*) are untouched.
//
// If `.next/BUILD_ID` is missing (e.g. building from a partial state),
// fall back to "dev" — the SW already defaults to that.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const buildIdPath = ".next/BUILD_ID";
const outPath = "public/sw-version.js";

const buildId = existsSync(buildIdPath)
  ? readFileSync(buildIdPath, "utf8").trim()
  : "dev";

const body = `self.APP_BUILD_ID = ${JSON.stringify(buildId)};\n`;
writeFileSync(outPath, body);
console.log(`[postbuild] wrote ${outPath} (APP_BUILD_ID=${buildId})`);
