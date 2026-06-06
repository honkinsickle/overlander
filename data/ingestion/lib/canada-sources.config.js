// canada-sources.config.js
// Source registry for the Canada far-north loaders.
// `// CONFIRM` = needs one introspection call (?f=json ESRI / DescribeFeatureType WFS).
// bc_rec_sites_poly verified 2026-06-05 against live DataBC.

export const CANADA_SOURCES = [
  // ---------- BRITISH COLUMBIA (DataBC WFS) ----------
  {
    id: 'bc_rec_sites_poly',
    adapter: 'wfs',
    base: 'https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_TENURE.FTEN_RECREATION_POLY_SVW/ows',
    typeName: 'WHSE_FOREST_TENURE.FTEN_RECREATION_POLY_SVW',
    geomField: 'GEOMETRY',        // verified (NOT SHAPE)
    oidField: 'OBJECTID',         // verified
    pageMax: 10000,
    nativeSrs: 'EPSG:3005',
    spatialForm: 'srid-literal',  // form (a) verified
    category: 'recreation_area',  // default for unmapped PROJECT_TYPE — verified 2026-06-06
    typeCategoryMap: {            // keyed on fieldMap.subtype = PROJECT_TYPE. In-corridor distinct:
      'Recreation Site': 'campground',        // 506
      'Recreation Reserve': 'recreation_area', // 456
      'Interpretative Forest': 'recreation_area', // 5 (note: layer spelling is "Interpretative")
      // unmapped (e.g. "Recreation Trail Reserve", 5) -> default recreation_area
    },
    reliability: 'A',
    license: 'OGL-BC',
    centroidFromPolygon: true,
    filter: "LIFE_CYCLE_STATUS_CODE='ACTIVE'",
    fieldMap: {
      name: 'PROJECT_NAME',
      subtype: 'PROJECT_TYPE',
      featureCode: 'RECREATION_MAP_FEATURE_CODE',
      definedCampsites: 'DEFINED_CAMPSITES',
      nearestTown: 'SITE_LOCATION',
      district: 'GEOGRAPHIC_DISTRICT_NAME',
      forestFileId: 'FOREST_FILE_ID',
    },
  },
  {
    id: 'bc_rec_sites_points_highvalue',
    adapter: 'wfs',
    base: 'https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW/ows',
    typeName: 'WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW',
    geomField: 'GEOMETRY',        // verified 2026-06-05
    oidField: 'OBJECTID',         // verified 2026-06-05
    pageMax: 10000,
    nativeSrs: 'EPSG:3005',
    category: 'campground',       // rec-SITE points are developed sites; layer has no PROJECT_TYPE — verified 2026-06-06
    reliability: 'A',
    license: 'OGL-BC',
    optional: true,               // high-value subset, NOT comprehensive
    fieldMap: { name: 'PROJECT_NAME' }, // verified 2026-06-05 (e.g. "Shesta Lake")
  },
  {
    id: 'bc_crown_tenures',
    adapter: 'wfs',
    base: 'https://openmaps.gov.bc.ca/geo/pub/WHSE_TANTALIS.TA_CROWN_TENURES_SVW/ows',
    typeName: 'WHSE_TANTALIS.TA_CROWN_TENURES_SVW',
    geomField: 'SHAPE',           // verified 2026-06-05
    oidField: 'OBJECTID',         // verified 2026-06-05
    pageMax: 10000,
    nativeSrs: 'EPSG:3005',
    role: 'legality_overlay',
    legalityStatus: 'restricted',   // allocated/granted tenures are EXCLUSIONS (dispersed restricted)
    designation: 'crown_tenure',
    filter: "TENURE_STAGE = 'TENURE'", // granted tenures only — drop APPLICATIONs
    fieldMap: { tenureType: 'TENURE_TYPE', stage: 'TENURE_STAGE', status: 'TENURE_STATUS', purpose: 'TENURE_PURPOSE' },
    reliability: 'A',
    license: 'OGL-BC',
    notes: 'legal dispersed = open Crown minus (tenures, parks, private). BC 14-day rule. Overlay → legality_overlay via upsert_legality_overlay RPC.',
  },
  {
    id: 'bc_rest_areas',
    adapter: 'wfs',
    base: 'https://openmaps.gov.bc.ca/geo/pub/WHSE_IMAGERY_AND_BASE_MAPS.MOT_REST_AREAS_SP/ows',
    typeName: 'WHSE_IMAGERY_AND_BASE_MAPS.MOT_REST_AREAS_SP',
    geomField: 'GEOMETRY',        // verified 2026-06-06 (gml:Point)
    oidField: 'OBJECTID',         // verified 2026-06-06
    pageMax: 10000,
    nativeSrs: 'EPSG:3005',
    category: 'rest_area',
    reliability: 'A',
    license: 'OGL-BC',
    fieldMap: {
      name: 'REST_AREA_NAME',                 // verified 2026-06-06 (e.g. "BULKLEY VIEW")
      subtype: 'REST_AREA_CLASS',             // e.g. "RAM Class C"
      toilets: 'NUMBER_OF_TOILETS',
      toiletType: 'TOILET_TYPE',              // e.g. "Pit"
      tables: 'NUMBER_OF_TABLES',
      largeVehicleOk: 'ACCOM_COMMERCIAL_TRUCKS_IND',
      openYearRound: 'OPEN_YEAR_ROUND_IND',
    },
  },

  // ---------- YUKON (GeoYukon ESRI REST) ----------
  {
    id: 'yk_parks_campgrounds',
    adapter: 'curated',
    file: 'curated/yk_campgrounds.ndjson', // 26 roadside YT campgrounds — curated 2026-06-06
    sourceIdField: 'source_id',
    category: 'campground',       // territorial developed (roadside) campgrounds — verified 2026-06-06
    typeCategoryMap: {            // keyed on fieldMap.subtype = 'kind'. Dataset carries no flag yet -> all fall back to 'campground'.
      roadside: 'campground',
      backcountry: 'dispersed_camping',
    },
    reliability: 'A',
    license: 'YK-OPEN (non-commercial free; commercial = written permission)',
    fieldMap: { name: 'name', subtype: 'kind', region: 'region' }, // name now from the curated file (was unverifiable ESRI NAME)
    // former ESRI source (cadastral, names only in REMARKS, no clean point layer):
    //   https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_ParksProtectedAreas/MapServer/0
    notes: 'Curated from GeoYukon Parks_and_Campgrounds_Surveyed shapefile (open.yukon.ca CKAN resource is PDF-only). Surveyed parcels = roadside; 21 backcountry sites lack a structured coord source and are NOT fabricated.',
  },
  {
    id: 'yk_gravel_pits',
    adapter: 'esri',
    base: 'https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_Transportation/MapServer', // layer id CONFIRM (Gravel_Pits_25k)
    oidField: 'OBJECTID',
    pageMax: 1000,
    requestSrs: 4326,
    category: 'dispersed_camping', // gravel pits used as dispersed sites — verified 2026-06-06
    reliability: 'B',
    license: 'YK-OPEN',
    optional: true,
  },
  {
    id: 'yk_land_tenure',
    adapter: 'esri',
    base: 'https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_LandTenure/MapServer', // enumerate live; IDs drift
    oidField: 'OBJECTID',
    pageMax: 1000,
    requestSrs: 4326,
    role: 'caution_overlay',
    reliability: 'A',
    license: 'YK-OPEN',
    notes: 'OIC withdrawals on .../36. No BC-style free-camp statute - caution only.',
  },

  // ---------- PARKS CANADA (ArcGIS Online) ----------
  {
    id: 'pc_accommodation',
    adapter: 'esri',
    enabled: false,               // DISABLED 2026-06-06 — REDUNDANT with existing parks_canada source
                                  // (2,924 'campground' rows, identical names = same vw_Accommodation layer).
                                  // Northern-corridor gap, if needed, is backfilled via the parks_canada
                                  // ingester on the full corridor — NOT this duplicate source.
    base: 'https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Accommodation_Hebergement_V2_FGP/FeatureServer/0',
    oidField: 'OBJECTID',         // confirmed
    pageMax: 2000,                // confirmed MaxRecordCount
    requestSrs: 4326,             // native 3857 -> force outSR=4326
    category: 'campground',       // developed PC campsites — verified 2026-06-06 (was invalid 'dispersed_camp')
    typeCategoryMap: {            // keyed on fieldMap.subtype = Accommodation_Type. In-corridor distinct:
      'Camping': 'campground',                                         // 4655
      'oTENTik': 'campground',                                         // 57 (developed glamping)
      'Group camping//Camping de groupe': 'campground',                // 2
      "Backcountry camping//Camping d'arrière-pays": 'dispersed_camping', // 197
      "Backcountry accommodation//Hébergement d'arrière-pays": 'dispersed_camping', // 3 (ACC huts)
      'Cabin//Chalet': 'camping_cabin',                                // 12
      'Mooring//Amarrage': null,                                       // 2 — boat buoys, EXCLUDE (not camping)
      // null-type rows (248) -> fall back to default 'campground'
    },
    rollup: { key: 'Name_e', emitGrain: 'campground', siteCountInto: 'capacity.site_count', dropNullKey: true }, // 5176 sites -> ~165 campgrounds; drop 248 nameless orphans
    reliability: 'A',
    license: 'OGL-Canada',
    fieldMap: { name: 'Name_e', subtype: 'Accommodation_Type', url: 'URL_e', siteNum: 'Site_Num_Site' },
    notes: 'Per-individual-site source; rolled up by Name_e to campground grain at ingest. ~167 campgrounds in corridor.',
  },

  // ---------- NWT (GNWT Geomatics ESRI REST) - CONDITIONAL ----------
  {
    id: 'nwt_territorial_parks',
    adapter: 'esri',
    base: 'https://www.apps.geomatics.gov.nt.ca/ArcGIS/rest/services', // service+layer CONFIRM
    oidField: 'OBJECTID',
    pageMax: 1000,
    requestSrs: 4326,
    category: 'campground',       // territorial developed campgrounds — verified 2026-06-06 (enabled:false, but token corrected)
    reliability: 'B',
    license: 'GNWT-OPEN',
    enabled: false,               // only if Dempster->Inuvik detour
  },
];
