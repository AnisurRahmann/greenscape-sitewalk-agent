/**
 * The pricing catalog for Greenscape Pro (Phoenix high-end hardscape
 * design-build). 210 SKUs across 19 categories, priced as INSTALLED unit
 * pricing with realistic 2025 Phoenix cost basis. Target gross margin per
 * line is 35-45%: unit_cost is derived here, never by the LLM (CLAUDE.md
 * rule 1).
 *
 * Near-duplicate SKUs are deliberate: travertine sizes, French-pattern
 * grades, pile heights, blade sizes etc. exist so catalog retrieval has to
 * distinguish close neighbours, not just keyword-match.
 */

export type CatalogUnit = 'sqft' | 'lf' | 'ea' | 'hr' | 'day';

export interface CatalogSeed {
  sku: string;
  category: string;
  name: string;
  description: string;
  unit: CatalogUnit;
  unitPrice: number;
  /** Target gross margin per line: (price - cost) / price, kept in 0.35-0.45. */
  margin: number;
  minQty: number;
  notes?: string;
}

export interface CatalogInsertRow {
  sku: string;
  category: string;
  name: string;
  description: string;
  unit: CatalogUnit;
  unit_price: number;
  unit_cost: number;
  min_qty: number;
  notes: string | null;
}

type ItemTuple = [
  sku: string,
  name: string,
  unit: CatalogUnit,
  unitPrice: number,
  margin: number,
  minQty: number,
  description: string,
  notes?: string,
];

function untag(category: string, items: ItemTuple[]): CatalogSeed[] {
  return items.map(([sku, name, unit, unitPrice, margin, minQty, description, notes]) => ({
    sku,
    category,
    name,
    unit,
    unitPrice,
    margin,
    minQty,
    description,
    notes,
  }));
}

// ---------------------------------------------------------------------------
// Pavers & Travertine (40)
// ---------------------------------------------------------------------------

const pavers = untag('Pavers & Travertine', [
  ['TRV-IVY-1624', 'Ivory Travertine Paver 16x24', 'sqft', 26.0, 0.42, 0, "Premium select ivory travertine, unfilled and tumbled for grip. Sand-set over compacted aggregate base with polymeric joints — Phoenix's best-value natural stone for pool decks and patios."],
  ['TRV-IVY-2424', 'Ivory Travertine Paver 24x24', 'sqft', 27.5, 0.42, 0, 'Same premium select ivory travertine in an oversized 24x24 module — fewer joints, more contemporary scale. Sand-set installation.'],
  ['TRV-IVY-1224', 'Ivory Travertine Paver 12x24', 'sqft', 25.5, 0.41, 0, 'Premium select ivory travertine in a running-bond 12x24 module. Sand-set over compacted base.'],
  ['TRV-IVY-FPP', 'French Pattern Ivory Travertine — Premium', 'sqft', 31.0, 0.4, 0, 'Premium select French pattern bundle (8x8, 8x16, 16x16, 16x24) ivory travertine, unfilled and tumbled, with tightly matched color tones.'],
  ['TRV-IVY-FPS', 'French Pattern Ivory Travertine — Standard', 'sqft', 26.5, 0.4, 0, 'Standard-grade French pattern ivory travertine bundle. Same layout as the premium bundle with wider color variance and fill blemishes — near-match to TRV-IVY-FPP, confirm grade before pricing.'],
  ['TRV-NOC-1624', 'Noche Travertine Paver 16x24', 'sqft', 25.0, 0.4, 0, 'Warm walnut-brown Noche travertine, unfilled and tumbled. Rich contrast against ivory bands and accents.'],
  ['TRV-WAL-1624', 'Walnut Travertine Paver 16x24', 'sqft', 25.5, 0.4, 0, 'Mid-brown walnut travertine, tumbled. Cooler grey-brown veining than Noche.'],
  ['TRV-SLV-1624', 'Silver Travertine Paver 16x24', 'sqft', 26.5, 0.41, 0, 'Cool grey silver travertine, unfilled and tumbled. Pairs with modern graphite-and-white palettes.'],
  ['TRV-ANT-FP', 'French Pattern Antique Travertine', 'sqft', 29.0, 0.4, 0, 'Antique-blend travertine French pattern bundle with gold and rust movement — old-world look at mid-tier price.'],
  ['TRV-IVY-PB', 'Ivory Travertine Paver 16x16 Tumbled', 'sqft', 24.0, 0.41, 0, 'Classic 16x16 tumbled ivory travertine. The budget-friendliest natural stone module we install.'],
  ['TRV-MIX-FP', 'French Pattern Mixed Travertine', 'sqft', 30.5, 0.4, 0, 'Blended ivory, Noche and walnut French pattern bundle — deliberate tri-color layout, not a single-tone bundle.'],
  ['TRV-IVY-CT', 'Ivory Travertine Pool Coping 12x24', 'lf', 38.0, 0.4, 0, 'Bullnosed 12x24 ivory travertine coping, 5cm thick, set on a 12-inch face. Priced per linear foot of pool edge.'],
  ['TRV-IVY-TL', 'Ivory Travertine Step Tread 6x12', 'lf', 22.0, 0.39, 0, '6x12 honed ivory travertine treads and accent bands for steps, landings and borders.'],
  ['TRV-SCF-2424', 'Scabos Travertine Paver 24x24', 'sqft', 25.5, 0.4, 0, 'Gold-and-rust Scabos travertine 24x24, tumbled. High-variance statement field.'],
  ['TRV-IVY-POOL', 'Ivory Travertine Paver 16x24 — Pool Grade', 'sqft', 28.5, 0.41, 0, 'Chiseled, unfilled pool-rated ivory travertine. Denser select stock with higher slip resistance than the standard 16x24.'],
  ['TRV-NOC-FP', 'French Pattern Noche Travertine', 'sqft', 29.5, 0.4, 0, 'Noche French pattern bundle, unfilled and tumbled — the dark-toned sibling of our ivory bundles.'],
  ['PV-CHL-60', 'Cobble Stone 60mm Paver', 'sqft', 16.5, 0.38, 0, '6cm pressed concrete cobble in triple-stacked color blends. The workhorse patio and walkway paver.'],
  ['PV-CHL-80', 'Cobble Stone 80mm Driveway Paver', 'sqft', 21.0, 0.38, 0, '8cm version of our Cobble Stone line rated for vehicular loads on driveways and motor courts.'],
  ['PV-GRY-60', 'Cobble Stone 60mm Paver — Graphite', 'sqft', 16.75, 0.38, 0, 'Graphite grey color blend of the Cobble Stone 60mm line.'],
  ['PV-SND-60', 'Cobble Stone 60mm Paver — Desert Sand', 'sqft', 16.75, 0.38, 0, 'Desert sand color blend of the Cobble Stone 60mm line.'],
  ['PV-SLT-60', 'Slatestone 60mm Paver', 'sqft', 17.5, 0.38, 0, 'Riven slate-textured 6cm concrete paver with angular face detail.'],
  ['PV-BRH-60', 'Brussels Block 60mm Paver', 'sqft', 18.5, 0.38, 0, 'Tumbled, antiqued 6cm concrete paver with softened edges and weathered face.'],
  ['PV-APL-60', 'Applique Large-Format Paver 24x36', 'sqft', 22.5, 0.37, 0, 'Oversized smooth-face 6cm flag at 24x36 for clean modern planes; requires tight bed tolerances.'],
  ['PV-URB-60', 'Urbana Stone 60mm Paver', 'sqft', 19.5, 0.37, 0, 'Plank-proportioned 6cm paver for contemporary linear layouts.'],
  ['PV-HRB-4X8', 'Herringbone 4x8 60mm Paver', 'sqft', 18.0, 0.38, 0, '4x8 plank cut sized for 90- and 45-degree herringbone fields — the pattern workhorse.'],
  ['PV-BKW-4X8', 'Basketweave 4x8 60mm Paver', 'sqft', 18.0, 0.38, 0, 'The same 4x8 module laid in paired basketweave — near-twin of the herringbone cut, different read.'],
  ['PV-DRV-80', 'Euro Cobble 80mm Driveway Paver', 'sqft', 23.5, 0.38, 0, 'Heavier 8cm stone-split-face cobble for motor courts and long drives.'],
  ['PV-PRL-60', 'Permeable 60mm Paver', 'sqft', 21.5, 0.37, 0, '6cm permeable interlocking paver on open-graded base for stormwater retention.'],
  ['PV-ANT-60', 'Antiqued Heritage 60mm Paver', 'sqft', 19.0, 0.38, 0, 'Heavily tumbled old-world 6cm paver with rolled edge chip.'],
  ['PV-TWN-60', 'Town Hall 60mm Paver', 'sqft', 19.75, 0.37, 0, 'Smooth architectural 6cm paver with crisp chamfers.'],
  ['PV-POLY-SAND', 'Polymeric Sand Jointing', 'sqft', 1.25, 0.45, 0, 'Polymeric joint sand swept, compacted and activated over new paver fields.'],
  ['PV-EDGE-REST', 'Paver Edge Restraint', 'lf', 6.5, 0.42, 0, 'HDPE edge restraint spiked into compacted base at all paver perimeters.'],
  ['PC-GRY-2424', 'Porcelain Paver 24x24 2cm — Grey', 'sqft', 34.0, 0.36, 0, '2cm structural porcelain paver, matte grey, sand-set or pedestal installation.'],
  ['PC-WD-848', 'Wood-Look Porcelain Paver 8x48', 'sqft', 38.5, 0.36, 0, '2cm porcelain plank with timber-look grain for deck-like patio surfaces.'],
  ['PC-MBL-2424', 'Marble-Look Porcelain Paver 24x24', 'sqft', 39.5, 0.36, 0, '2cm porcelain with polished white marble effect — high-end look, low upkeep.'],
  ['PC-PED-PAD', 'Pedestal System for Porcelain', 'sqft', 9.5, 0.4, 0, 'Adjustable pedestals and levelling pads carrying porcelain over sloped decks.'],
  ['PV-SEAL-WS', 'Wet-Look Paver Sealer', 'sqft', 1.65, 0.45, 0, 'Penetrating wet-look seal, two coats, cure time included.'],
  ['PV-LIFT-RELAY', 'Paver Lift & Relay', 'sqft', 8.5, 0.4, 0, 'Careful lift, re-bed and relay of existing paver fields for repairs or utility access.'],
  ['PV-STEP-PVR', 'Paver Steps (per riser)', 'ea', 385.0, 0.4, 0, 'Modular paver step riser with retained gravel core and solid tread.'],
  ['PV-COP-BLN', 'Bullnose Concrete Pool Coping', 'lf', 32.0, 0.4, 0, 'Precast bullnose coping on pool edge, mortared set with waterline alignment.'],
]);

// ---------------------------------------------------------------------------
// Concrete & Stamped (20)
// ---------------------------------------------------------------------------

const concrete = untag('Concrete & Stamped', [
  ['CC-BR-4', 'Broom Finish Concrete Slab 4"', 'sqft', 11.5, 0.4, 250, '4-inch broom-finished patio or walk slab on prepared grade with mesh and control joints.'],
  ['CC-BR-5', 'Broom Finish Concrete Driveway 5"', 'sqft', 14.0, 0.4, 250, '5-inch drivable slab with #4 rebar grid on compacted subgrade.'],
  ['CC-INT-COL', 'Integral Color Concrete 4"', 'sqft', 14.5, 0.42, 250, 'Integral pigment through the full slab depth, broom finished.'],
  ['CC-SC-ASH', 'Stamped Concrete — Ashlar Slate', 'sqft', 18.5, 0.42, 200, 'Ashlar slate stamps with antique release, saw-cut joints and sealer.'],
  ['CC-SC-FLG', 'Stamped Concrete — Flagstone', 'sqft', 18.5, 0.42, 200, 'Grand flagstone pattern stamps in a two-tone antique finish.'],
  ['CC-SC-COB', 'Stamped Concrete — Olde English Cobble', 'sqft', 18.0, 0.42, 200, 'Rounded cobble stamps with antique release and sealed finish.'],
  ['CC-SC-RSK', 'Stamped Concrete — Seamless Skin', 'sqft', 16.5, 0.42, 200, 'Seamless texture skin with light relief — the cleanest modern stamp.'],
  ['CC-SC-RMN', 'Stamped Concrete — Roman Slate', 'sqft', 18.0, 0.42, 200, 'Large-format Roman slate texture stamps with hand-toned highlights.'],
  ['CC-SC-BDR', 'Stamped Border (per LF)', 'lf', 24.0, 0.4, 0, 'Contrasting stamped border band 12-18 inches wide with saw-cut frame.'],
  ['CC-SC-2TONE', 'Two-Tone Antique Release', 'sqft', 2.25, 0.45, 0, 'Secondary color hardener and release tone for multi-tone stamp work.'],
  ['CC-SEAL-DC', 'Decorative Concrete Sealer', 'sqft', 1.4, 0.45, 0, 'Solvent-acrylic wet-look sealer with nonslip grit, two coats.'],
  ['CC-JOINT-CUT', 'Control & Expansion Joint Cuts', 'lf', 4.75, 0.42, 0, 'Saw-cut control joints to panel layout; expansion felt at abutments.'],
  ['CC-DRV-APRON', 'Driveway Apron Replacement', 'sqft', 16.5, 0.38, 100, 'Municipal driveway apron replacement to city detail, permit coordination included.'],
  ['CC-STEP-RSR', 'Concrete Steps (per riser)', 'ea', 340.0, 0.4, 0, 'Formed and poured steps, broom finish, rebar tied to footing.'],
  ['CC-SALT-POOL', 'Salt-Finish Pool Deck', 'sqft', 15.5, 0.4, 200, 'Rock-salt textured cool deck for barefoot pool surrounds.'],
  ['CC-KOOL-OVL', 'Kool Deck Acrylic Overlay', 'sqft', 13.0, 0.38, 200, 'Acrylic cementitious cool overlay over an existing sound deck.'],
  ['CC-MICRO-TOP', 'Micro-Topping Overlay', 'sqft', 9.5, 0.38, 150, '1/16-inch polymer overlay to resurface sound slabs; tintable.'],
  ['CC-STEM-24', 'Stem Wall / Grade Beam 24"', 'lf', 68.0, 0.4, 0, '24-inch formed stem wall with #4 rebar for raised planters and porch edges.'],
  ['CC-MOW-CURB', 'Mow Curb / Landscape Curbing', 'lf', 14.5, 0.42, 0, 'Continuous extruded 4x6 concrete curb separating turf from rock beds.'],
  ['CC-EXP-AGG', 'Exposed Aggregate Finish', 'sqft', 16.0, 0.4, 200, 'Surface-retarder exposed pea aggregate, washed and sealed.'],
]);

// ---------------------------------------------------------------------------
// Retaining Walls (16)
// ---------------------------------------------------------------------------

const walls = untag('Retaining Walls', [
  ['RW-AB-FACE', 'Segmental Block Retaining Wall', 'sqft', 62.0, 0.4, 0, 'Allan-Block-class segmental wall to 4 feet, gravity section with compacted rock backfill.'],
  ['RW-AB-ENG', 'Engineered Block Wall 4-8 ft', 'sqft', 88.0, 0.4, 0, 'Geogrid-reinforced segmental wall built to engineered detail with inspection holds.'],
  ['RW-BLD-TON', 'Boulder Retaining Wall (placed)', 'ea', 325.0, 0.4, 0, 'Machine-placed moss rock boulder wall, keyed and stacked.', 'Priced per ton of boulder placed.'],
  ['RW-BLD-DRY', 'Dry-Stack Boulder Accent Wall', 'ea', 295.0, 0.4, 0, 'Lower-height dry-stack boulder feature wall without mortar.', 'Priced per ton of boulder placed.'],
  ['RW-SW-AB', 'Block Seat Wall 18"', 'lf', 118.0, 0.4, 0, '18-inch segmental seat wall with cap; conduit-ready for lighting.'],
  ['RW-SW-STN', 'Natural Stone Seat Wall', 'lf', 145.0, 0.4, 0, 'Chopped-stone masonry seat wall with bluestone-class cap.'],
  ['RW-CAP-16', 'Wall Cap 16"', 'lf', 28.0, 0.42, 0, 'Precast or natural 16-inch wall cap, adhered with drip overhang.'],
  ['RW-GEOGRID', 'Geogrid Reinforcement', 'sqft', 1.05, 0.42, 0, 'Biaxial geogrid lifts at engineered spacing with verified compaction.', 'Priced per square foot of reinforcement.'],
  ['RW-DRAIN-CMP', 'Wall Drainage Composite + Pipe', 'lf', 18.5, 0.42, 0, 'Drainage composite with 4-inch perforated collector at the heel, daylighted.'],
  ['RW-BK-FILL', 'Crushed Rock Wall Backfill', 'ea', 95.0, 0.4, 0, '3/4-inch clean chip backfill zone behind retaining walls.', 'Priced per ton installed.'],
  ['RW-FW-PHX', 'Perimeter Courtyard Wall (face sqft)', 'sqft', 48.0, 0.38, 0, 'CMU courtyard and perimeter wall, finish-ready both sides on engineered footing.'],
  ['RW-FW-CAP', 'Perimeter Wall Cap', 'lf', 22.0, 0.4, 0, 'Precast caps on courtyard walls with tooled joints.'],
  ['RW-FW-STU', 'Stucco Wall Finish (both sides)', 'sqft', 14.0, 0.4, 0, 'Two-coat stucco to both wall faces with control-joint sealant.'],
  ['RW-PIL-18', 'Wall Pilaster 18x18', 'ea', 265.0, 0.4, 0, 'Grouted pilaster with vertical rebar at wall expansion points.'],
  ['RW-GATE-COL', 'Gate Column / Framing', 'ea', 780.0, 0.4, 0, 'Reinforced gate column with embedded hardware for gates to 6 feet.'],
  ['RW-ENG-FEE', 'Structural Wall Engineering', 'ea', 2850.0, 0.35, 0, 'PE-stamped calcs and details for walls over 4 feet; permit-ready.'],
]);

// ---------------------------------------------------------------------------
// Pergolas & Ramadas (12)
// ---------------------------------------------------------------------------

const pergolas = untag('Pergolas & Ramadas', [
  ['PG-WD-ATT', 'Cedar Wood Pergola — Attached', 'sqft', 98.0, 0.4, 0, '#1 rough-sawn cedar 6x6/2x8 structure with ledger to house framing, stained.'],
  ['PG-WD-FS', 'Cedar Wood Pergola — Freestanding', 'sqft', 112.0, 0.4, 0, 'Freestanding cedar pergola on concealed post bases with bell footings.'],
  ['PG-ALU-ATT', 'Aluminum Pergola — Attached', 'sqft', 84.0, 0.42, 0, 'Powder-coated aluminum structure, zero-maintenance, with integrated gutter beam.'],
  ['PG-ALU-FS', 'Aluminum Pergola — Freestanding', 'sqft', 94.0, 0.42, 0, 'Freestanding aluminum frame on base plates and footings.'],
  ['PG-LVR-MOT', 'Motorized Louvered Aluminum Pergola', 'sqft', 168.0, 0.38, 0, 'App-controlled rotating louvers with integrated gutter and rain-close sensors.'],
  ['PG-LVR-LED', 'Louvered Pergola with Perimeter LED', 'sqft', 182.0, 0.38, 0, 'The same motorized louvered structure dressed for evening use — perimeter LED channel and dimming. Confirm which variant the client wants before pricing.'],
  ['RM-WD-SHG', 'Wood Ramada — Shingle Roof', 'sqft', 145.0, 0.38, 0, 'Heavy-timber cedar ramada with cedar shake or composite shingle hip roof.'],
  ['RM-STL-SS', 'Steel Ramada — Standing Seam', 'sqft', 165.0, 0.38, 0, 'Steel-frame ramada with standing-seam metal hip roof.'],
  ['PG-FOOT-CORE', 'Pergola Footings & Post Cores', 'ea', 420.0, 0.4, 0, '18-inch bell footings with mechanical post anchors, per column.'],
  ['PG-ELEC-PKG', 'Pergola Electrical Package', 'ea', 685.0, 0.4, 0, 'Ceiling fan box, dimmable light circuit and GFCI rough-in to the pergola.'],
  ['PG-SAIL-POST', 'Shade Sail with Posts', 'ea', 3450.0, 0.4, 0, 'Tensioned commercial shade sail on galvanized posts with footings.'],
  ['PG-STAIN-CED', 'Cedar Stain & Seal', 'sqft', 4.5, 0.42, 0, 'Two-coat penetrating stain to all faces, masked and back-primed.'],
]);

// ---------------------------------------------------------------------------
// Fire Features (10)
// ---------------------------------------------------------------------------

const fire = untag('Fire Features', [
  ['FF-PIT-SQ-ML', 'Gas Fire Pit — Square 42" Match-Lit', 'ea', 7400.0, 0.42, 0, 'CMU-and-stucco square fire pit, 42 inches, match-lit key valve, lava media and cap.'],
  ['FF-PIT-RD-ML', 'Gas Fire Pit — Round 36" Match-Lit', 'ea', 6900.0, 0.42, 0, 'Round 36-inch gas fire pit, match-lit, tumbled glass media.'],
  ['FF-PIT-SQ-EI', 'Gas Fire Pit — Square 42" Electronic Ignition', 'ea', 8250.0, 0.42, 0, 'The same square 42-inch build upgraded to electronic ignition with flame sensing and wall switch. Confirm match-lit vs electronic before pricing.'],
  ['FF-PIT-WD', 'Wood-Burning Fire Pit', 'ea', 5200.0, 0.4, 0, 'Boulder and stone wood-burning pit with steel ring and spark screen.'],
  ['FF-PLC-CST', 'Outdoor Fireplace — Stucco & Stone', 'ea', 24500.0, 0.4, 0, 'Masonry gas fireplace with refractory box, stone veneer, poured hearth and mantel.'],
  ['FF-PLC-PF', 'Prefab Outdoor Fireplace Unit', 'ea', 14800.0, 0.38, 0, 'Prefab stainless firebox fireplace with veneer skirt and cap.'],
  ['FF-BOWL-CF', 'Concrete Fire Bowl with Burner', 'ea', 2850.0, 0.4, 0, 'GFRC bowl with stainless ring burner, match-lit, on pedestal.'],
  ['FF-GAS-RUN', 'Gas Line Run to Fire Feature', 'lf', 42.0, 0.38, 0, 'CSST or black-iron run from the meter with shutoff and pressure test.'],
  ['FF-BURN-KIT', 'Burner Pan & Key Valve Kit', 'ea', 1150.0, 0.38, 0, 'Stainless burner pan with key valve, flex connect and pan ring.'],
  ['FF-MEDIA', 'Fire Glass / Lava Media', 'ea', 385.0, 0.45, 0, 'Media fill for burner pans — tempered fire glass or tumbled lava rock.'],
]);

// ---------------------------------------------------------------------------
// Water Features (8)
// ---------------------------------------------------------------------------

const water = untag('Water Features', [
  ['WF-BUB-3RK', 'Bubbling Rock Fountain (3-rock)', 'ea', 4650.0, 0.4, 0, 'Triple bubbling boulders on a shared vault with auto-fill and 2-inch gravel basin.'],
  ['WF-URN-CAST', 'Cast-Stone Urn Fountain', 'ea', 4950.0, 0.4, 0, 'Cast-stone urn on a buried reservoir with pump and auto-fill.'],
  ['WF-PWL-STD', 'Pondless Waterfall with Stream', 'ea', 11800.0, 0.4, 0, 'Pondless vault with 6-8 foot stream, boulder edging and LED uplights.'],
  ['WF-PWL-LG', 'Large Pondless Waterfall (6 ft+ drop)', 'ea', 18500.0, 0.4, 0, 'High-head pondless system with twin pumps and a 12-foot-plus run — the big sibling of our standard falls.'],
  ['WF-POND-KOI', 'Koi Pond with Filtration', 'ea', 26500.0, 0.4, 0, 'Rubber-lined koi pond with bottom drain, bead filter and UV clarification.'],
  ['WF-WALL-SD', 'Water Wall / Sheer Descent', 'ea', 8900.0, 0.4, 0, 'Raised bond-beam water wall with sheer-descent spillway and clad face.'],
  ['WF-PUMP-SVC', 'Feature Pump / Auto-Fill Replacement', 'ea', 1250.0, 0.38, 0, 'Replace pump or float valve, re-wire timer and reset flow.'],
  ['WF-STARTUP', 'Feature Startup & Water Treatment', 'ea', 285.0, 0.45, 0, 'Startup service: fill, dose, prime and verify auto-fill.'],
]);

// ---------------------------------------------------------------------------
// Outdoor Kitchens (14)
// ---------------------------------------------------------------------------

const kitchens = untag('Outdoor Kitchens', [
  ['OK-CTR-GRN', 'Kitchen Counter Run — Granite Top', 'lf', 1050.0, 0.4, 0, 'Masonry-frame kitchen run, stucco or stone finish, 3cm granite top with mitered edge.'],
  ['OK-CTR-QTZ', 'Kitchen Counter Run — Quartzite Top', 'lf', 1285.0, 0.4, 0, 'The same counter run dressed with 3cm quartzite — harder and more figured than granite. Confirm stone selection before pricing.'],
  ['OK-ISL-PF', 'Prefab Grill Island with Top', 'ea', 9800.0, 0.38, 0, 'Modular stone-clad island with drop-in top and grill/door cutouts.'],
  ['OK-GRILL-36', 'Built-In Gas Grill 36"', 'ea', 5400.0, 0.38, 0, '36-inch stainless built-in with rotisserie and infrared back burner.'],
  ['OK-GRILL-42', 'Built-In Gas Grill 42"', 'ea', 7900.0, 0.38, 0, '42-inch flagship built-in with dedicated sear zone and rotisserie — the larger sibling of the 36-inch unit.'],
  ['OK-SDBRN-2', 'Double Side Burner', 'ea', 1850.0, 0.38, 0, 'Drop-in dual side burner with lid and spark ignition.'],
  ['OK-FRIDGE', 'Outdoor Refrigerator', 'ea', 2350.0, 0.38, 0, 'Weather-rated stainless under-counter fridge on a dedicated circuit.'],
  ['OK-BAR-LF', 'Bar Counter with Overhang', 'lf', 1250.0, 0.4, 0, 'Raised bar back with 12-inch overhang, foot rail and stone face.'],
  ['OK-SINK-HC', 'Outdoor Sink with Hot & Cold', 'ea', 1650.0, 0.38, 0, 'Stainless sink with hot/cold faucet and air-gap drain to waste.'],
  ['OK-DOOR-DR', 'Access Door & Double Drawer Combo', 'ea', 1450.0, 0.38, 0, 'Stainless door/drawer tower set into a masonry cutout.'],
  ['OK-TRASH-PO', 'Pull-Out Trash & Recycle', 'ea', 985.0, 0.38, 0, 'Twin-bin pull-out in a stainless sleeve.'],
  ['OK-KEG', 'Outdoor Kegerator', 'ea', 2950.0, 0.36, 0, 'Weather-rated draft tower unit on a dedicated GFCI circuit.'],
  ['OK-GAS-WTR', 'Kitchen Gas & Water Rough-In', 'ea', 1850.0, 0.38, 0, 'Gas, water and waste stubs pressure-tested before finishes.'],
  ['OK-ELEC-PKG', 'Kitchen Electrical Package', 'ea', 950.0, 0.4, 0, 'GFCI circuits, task lighting and low-voltage under-counter outlets.'],
]);

// ---------------------------------------------------------------------------
// Artificial Turf (8)
// ---------------------------------------------------------------------------

const turf = untag('Artificial Turf', [
  ['TF-PET-70', 'Pet-Grade Turf 70 oz', 'sqft', 9.75, 0.42, 250, 'Pet-rated 70 oz turf with antimicrobial backing, zeolite-ready; nailed and seamed on AB base.'],
  ['TF-PRE-90', 'Premium Turf 90 oz', 'sqft', 11.5, 0.42, 250, '90 oz multi-tone premium turf with tan thatch — the softest underfoot.'],
  ['TF-STD-60', 'Standard Turf 60 oz', 'sqft', 8.25, 0.4, 250, '60 oz landscape turf for low-wear areas.'],
  ['TF-PUTT-NYL', 'Putting Green — Nylon Pro', 'sqft', 16.5, 0.4, 150, 'Tour-style nylon green with fringe and cup sets.'],
  ['TF-INFILL-ZEO', 'Zeolite Pet Infill', 'sqft', 1.35, 0.45, 0, 'Zeolite infill that captures ammonia odors in pet installs — choose this over silica for dogs.'],
  ['TF-INFILL-SIL', 'Silica Sand Infill', 'sqft', 0.85, 0.45, 0, 'Rounded silica infill for ballast and blade stand-up.'],
  ['TF-SEAM-ADH', 'Turf Seaming & Perimeter Detail', 'lf', 7.5, 0.42, 0, 'Glued seams, hidden nails and tucked edges at hardscape transitions.'],
  ['TF-BASE-AB', 'Turf Base — Class II AB + Weed Barrier', 'sqft', 3.25, 0.4, 0, '3-inch compacted AB with weed fabric, graded to drains.'],
]);

// ---------------------------------------------------------------------------
// Irrigation (12)
// ---------------------------------------------------------------------------

const irrigation = untag('Irrigation', [
  ['IR-ZN-DP', 'Drip Zone (shrubs)', 'ea', 485.0, 0.4, 0, 'New drip zone: valve, filter, regulator and poly laterals with pressure-compensating emitters.'],
  ['IR-ZN-SP', 'Spray Zone (4-6 heads)', 'ea', 560.0, 0.4, 0, 'New spray zone with valve, lateral trenching, heads and tuned nozzles.'],
  ['IR-MP-CONV', 'MP Rotator Conversion (per head)', 'ea', 98.0, 0.42, 0, 'Swap spray heads to MP rotator nozzles for matched precipitation and less misting.'],
  ['IR-CTRL-SM8', 'Smart Controller 8-Zone', 'ea', 985.0, 0.38, 0, 'WiFi weather-based smart controller installed with zone programming and rain sensor.'],
  ['IR-CTRL-FIX', 'Controller Rewire / Zone Troubleshoot', 'ea', 285.0, 0.4, 0, 'Trace and repair zone wiring, solenoids and program faults.'],
  ['IR-VALVE-REP', 'Valve Replacement', 'ea', 445.0, 0.4, 0, 'Replace a failed valve, clean the box and verify bleed.'],
  ['IR-BFLW-RP', 'RP Backflow Assembly Install', 'ea', 1650.0, 0.35, 0, 'Reduced-pressure backflow assembly with copper connections and certified test report.'],
  ['IR-MAIN-FIX', 'PVC Mainline Repair', 'ea', 685.0, 0.38, 0, 'Locate and repair pressure main breaks, flush lines and restore the surface.'],
  ['IR-LAT-LF', 'New Lateral Line Run', 'lf', 24.0, 0.38, 0, 'Sch-40 lateral trenching with hardscape sleeves where needed.'],
  ['IR-CAP-HEAD', 'Cap & Abandon Heads', 'ea', 45.0, 0.45, 0, 'Cap heads and laterals when converting zones to drip or hardscape.'],
  ['IR-POP-12', '12" Pop-Up Spray Head with Nozzle', 'ea', 68.0, 0.42, 0, '12-inch pop-up with matched-precipitation nozzle set to arc.'],
  ['IR-DP-1G', 'Pressure-Compensating Dripper 1 GPH', 'ea', 12.0, 0.45, 0, 'PC dripper on 1/4-inch distribution, flushed and tested.'],
]);

// ---------------------------------------------------------------------------
// Landscape Lighting (12)
// ---------------------------------------------------------------------------

const lighting = untag('Landscape Lighting', [
  ['LL-UPL-BRS', 'Brass LED Uplight', 'ea', 395.0, 0.4, 0, 'Cast-brass uplight with 2700K lamp, aiming and beam shaping.'],
  ['LL-SPOT-WASH', 'Spot / Wash Light', 'ea', 365.0, 0.4, 0, 'Brass wall-wash fixture for facades and hedges — softer sibling of the uplight.'],
  ['LL-PATH-BRS', 'Brass Path Light', 'ea', 345.0, 0.4, 0, 'Brass path and garden light on stake, spaced for even pools of light.'],
  ['LL-STEP-DECK', 'Step / Deck Light', 'ea', 285.0, 0.4, 0, 'Recessed hardscape step light with a shielded face.'],
  ['LL-TR-300', 'Transformer 300W with Photocell + Timer', 'ea', 825.0, 0.4, 0, 'Multi-tap stainless transformer with photocell, timer and internal breaker.'],
  ['LL-TR-600', 'Transformer 600W', 'ea', 1150.0, 0.4, 0, 'The same multi-tap platform at 600W for larger systems — check load math before choosing over the 300W.'],
  ['LL-WIRE-12-2', 'Low-Voltage 12/2 Wire Run', 'lf', 6.5, 0.4, 0, 'Direct-burial 12/2 hub runs with conduit under crossings.'],
  ['LL-HUB-KIT', 'Hub / Waterproof Splice Kit', 'ea', 45.0, 0.45, 0, 'Hub method with sealed connectors — no pierce clips.'],
  ['LL-RETRO-LED', 'LED Lamp Retrofit', 'ea', 38.0, 0.45, 0, 'Swap halogen lamps to warm-dim LEDs and re-aim.'],
  ['LL-ZONE-ADD', 'Zone Add-On to Existing Transformer', 'ea', 245.0, 0.42, 0, 'Add a tap and zone after confirming breaker capacity.'],
  ['LL-CTRL-APP', 'App Dimming / Zone Controller', 'ea', 385.0, 0.38, 0, 'Bluetooth app zones with dimming scenes.'],
  ['LL-TREE-KIT', 'Tree-Mount Uplight Kit', 'ea', 465.0, 0.4, 0, 'Canopy-mount uplight kit with bracket and glare shield.'],
]);

// ---------------------------------------------------------------------------
// Planting & Trees (14)
// ---------------------------------------------------------------------------

const planting = untag('Planting & Trees', [
  ['PT-TR-24', '24" Box Tree — Installed & Staked', 'ea', 785.0, 0.4, 0, '24-inch box tree planted, amended, staked with basin and drip.'],
  ['PT-TR-36', '36" Box Tree — Installed & Staked', 'ea', 1850.0, 0.4, 0, '36-inch box specimen with guying and basin — one size up from our 24-inch box work.'],
  ['PT-TR-48', '48" Box Specimen Tree', 'ea', 3850.0, 0.38, 0, 'Crane-set 48-inch box statement tree.'],
  ['PT-PAL-MFN', 'Mexican Fan Palm 16 ft CT', 'ea', 1250.0, 0.38, 0, 'Washingtonia at 16-foot clear trunk, braced with crown drench.'],
  ['PT-PAL-MED', 'Mediterranean Fan Palm (multi-trunk)', 'ea', 950.0, 0.38, 0, 'Clumping fan palm with sculpted skirt, field located.'],
  ['PT-SAGUARO', 'Saguaro Cactus (nursery-grown)', 'ea', 4500.0, 0.35, 0, 'Nursery-grown saguaro with state tags, crane set and native plant permit.'],
  ['PT-AGV-30', 'Agave americana 30"', 'ea', 385.0, 0.4, 0, 'Specimen blue agave set on a raised mound for drainage.'],
  ['PT-SHR-15', '15-Gallon Shrub', 'ea', 145.0, 0.4, 0, '15-gallon shrub planted with amendment and drippers.'],
  ['PT-ACC-5', '5-Gallon Accent', 'ea', 58.0, 0.4, 0, '5-gallon accent grass or succulent.'],
  ['PT-GC-FLAT', 'Ground Cover Flat', 'ea', 42.0, 0.38, 0, '16-count flat of trailing ground cover.'],
  ['PT-SOIL-AMD', 'Soil Amendment & Starter Fertilizer', 'sqft', 0.45, 0.42, 0, 'Till in compost and starter fertilizer across planting areas.'],
  ['PT-DRIP-NEW', 'New Plant Drip Lines & Emitters', 'ea', 285.0, 0.4, 0, 'Drip distribution for a planted area with adjustable emitters.'],
  ['PT-TR-RING', 'Granite Tree Ring (banded DG)', 'ea', 320.0, 0.4, 0, 'Steel-banded DG basin ring at the tree trunk.'],
  ['PT-MULCH-YD', 'Topdress / Mulch (per yard)', 'ea', 145.0, 0.42, 3, 'Bark or gravel topdress, beds dressed and raked clean.', 'Priced per cubic yard.'],
]);

// ---------------------------------------------------------------------------
// Demolition & Haul-Off (8)
// ---------------------------------------------------------------------------

const demolition = untag('Demolition & Haul-Off', [
  ['DH-CONC-DEM', 'Concrete Demo + Haul-Off', 'sqft', 5.25, 0.38, 100, 'Sawcut, break, remove and dispose slabs up to 6 inches thick.'],
  ['DH-PAV-DEM', 'Paver / Hardscape Demo', 'sqft', 4.5, 0.38, 100, 'Lift pavers and natural stone, salvage where practical, haul base as needed.'],
  ['DH-GRASS-RM', 'Natural Grass Removal', 'sqft', 1.85, 0.4, 250, 'Sod cut, roots raked and hauled — pre-turf conversion prep.'],
  ['DH-GRV-RM', 'Gravel / Rock Removal', 'sqft', 2.25, 0.38, 250, 'Load and haul existing rock, then grade the remaining soil.'],
  ['DH-PLANT-RM', 'Shrub / Plant Removal', 'ea', 85.0, 0.4, 0, 'Cut out, grub roots and dispose; drip lines capped.'],
  ['DH-TREE-SM', 'Small Tree Removal (under 20 ft)', 'ea', 425.0, 0.38, 0, 'Cut, grind stump to 8 inches and haul debris.'],
  ['DH-HAUL-TR', 'Bulk Haul-Off (per trailer)', 'ea', 495.0, 0.4, 1, '12-yard trailer load to the dump; mixed inert debris.', 'Priced per trailer load.'],
  ['DH-WALL-DEM', 'Block Wall Demo', 'sqft', 9.5, 0.38, 50, 'Take down CMU walls, haul masonry and cap the footing flush.'],
]);

// ---------------------------------------------------------------------------
// Grading (4)
// ---------------------------------------------------------------------------

const grading = untag('Grading', [
  ['GR-ROUGH-SF', 'Rough Grade with Skid Steer', 'sqft', 0.42, 0.38, 1000, 'Machine rough grading to plan elevations with spoils spread on site.'],
  ['GR-FINE-SF', 'Laser Fine Grade', 'sqft', 0.58, 0.4, 500, 'Laser-levelled finish readied for pavers or turf.'],
  ['GR-CUT-EXP', 'Cut/Fill Export (per yard)', 'ea', 95.0, 0.38, 5, 'Off-haul export per cubic yard including dump fees.', 'Priced per cubic yard.'],
  ['GR-DRAIN-RESLOPE', 'Re-Slope to Drain Corrections', 'sqft', 0.85, 0.4, 200, 'Correct negative drainage at foundations and hardscape toward a 2% minimum.'],
]);

// ---------------------------------------------------------------------------
// Drainage (8)
// ---------------------------------------------------------------------------

const drainage = untag('Drainage', [
  ['DR-FR-4', 'French Drain 4" with Rock', 'lf', 46.0, 0.4, 0, '4-inch perforated pipe in washed rock and fabric, daylighted.'],
  ['DR-FR-6', 'French Drain 6" (heavy flow)', 'lf', 62.0, 0.4, 0, '6-inch perforated collector sized for monsoon volumes — spec this over the 4-inch on large sheds.'],
  ['DR-BASIN-12', 'Catch Basin 12" with Grate', 'ea', 385.0, 0.4, 0, '12-inch square basin with cast grate tied to solid discharge.'],
  ['DR-CHAN-5', 'Channel Drain 5" (driveway)', 'lf', 68.0, 0.38, 0, 'Polymer channel with class-B grate across drives and walks.'],
  ['DR-POP-EMT', 'Pop-Up Emitter', 'ea', 165.0, 0.42, 0, 'Pop-up discharge outlet with splash block and turf repair.'],
  ['DR-DRY-44', 'Dry Well 4x4x4 with Rock', 'ea', 1450.0, 0.38, 0, 'Infiltration dry well with wrap, silt sock and rock column.'],
  ['DR-SDR-4', '4" SDR-35 Discharge Pipe', 'lf', 28.0, 0.4, 0, 'Solid SDR-35 runs sloped at 1% minimum between structures.'],
  ['DR-DSP-TIE', 'Downspout Tie-In', 'ea', 145.0, 0.42, 0, 'Capture roof leaders into the subsurface system with cleanouts.'],
]);

// ---------------------------------------------------------------------------
// Gravel & Decomposed Granite (9)
// ---------------------------------------------------------------------------

const gravel = untag('Gravel & DG', [
  ['GD-DG-MGD', 'Madison Gold DG — 2" Compacted', 'sqft', 2.95, 0.4, 250, 'Madison Gold decomposed granite, screened, water-set and rolled at 2 inches.'],
  ['GD-DG-MGD-STB', 'Stabilized Madison Gold DG', 'sqft', 4.1, 0.4, 250, 'The same Madison Gold with stabilizer binder — firmer paths and less shoe tracking. Near-match to plain MG DG; confirm stabilization before pricing.'],
  ['GD-DG-GRN', 'Desert Green DG — 2" Compacted', 'sqft', 3.1, 0.4, 250, 'Desert green DG blend for contrast against gold tones.'],
  ['GD-GRV-PEA', 'Pea Gravel 3/8" — 2" Depth', 'sqft', 3.25, 0.4, 250, 'Washed 3/8-inch pea gravel over weed fabric with steel edging.'],
  ['GD-GRV-AG', 'Apache Gold 1/2" Screened', 'sqft', 3.75, 0.4, 250, 'Warm Apache Gold 1/2-inch decorative rock.'],
  ['GD-GRV-RIV', 'River Slicks 3-5" Accent', 'sqft', 4.5, 0.38, 100, 'Large river slick accent cobble for dry washes.'],
  ['GD-RIP-RAP', 'Rip-Rap / Detail Boulders', 'ea', 425.0, 0.38, 1, 'Placed rip-rap or detail boulders, machine set.', 'Priced per ton placed.'],
  ['GD-AB-CLASS2', 'Class II Aggregate Base (per ton)', 'ea', 85.0, 0.38, 2, 'Class II AB delivered, spread, watered and compacted to 95%.', 'Priced per ton installed.'],
  ['GD-EDG-STEEL', 'Steel Landscape Edging', 'lf', 18.5, 0.4, 0, '4-inch steel edging staked every 30 inches, contoured to layout.'],
]);

// ---------------------------------------------------------------------------
// Mobilization (3)
// ---------------------------------------------------------------------------

const mobilization = untag('Mobilization', [
  ['MOB-SM', 'Mobilization — Small Project', 'ea', 1850.0, 0.35, 1, 'Small-project setup: containers, temp fence, dumpsters and haul-route controls.'],
  ['MOB-LG', 'Mobilization — Large / Phased', 'ea', 3200.0, 0.35, 1, 'Phased-project setup with the site superintendent, staging and property protection.'],
  ['MOB-TELE-DAY', 'Telehandler / Boom Day Rate', 'day', 875.0, 0.38, 1, 'Operator and machine day rate for material placing.'],
]);

// ---------------------------------------------------------------------------
// Permit Handling (3)
// ---------------------------------------------------------------------------

const permits = untag('Permit Handling', [
  ['PM-STD', 'Standard Building Permit Handling', 'ea', 950.0, 0.4, 1, 'Prepare and run standard patio, gazebo and wall permits through the City of Phoenix.'],
  ['PM-ENG', 'Engineering Plans & Permit Expediting', 'ea', 2850.0, 0.35, 1, 'PE drawings, engineering letters and expediting for structural scope.'],
  ['PM-GAS', 'Gas Line Permit & Inspection', 'ea', 650.0, 0.4, 1, 'Gas permit, pressure test and inspection scheduling.'],
]);

// ---------------------------------------------------------------------------
// HOA Package Prep (2)
// ---------------------------------------------------------------------------

const hoa = untag('HOA Package Prep', [
  ['HOA-PKG', 'HOA Submittal Package Prep', 'ea', 685.0, 0.42, 1, 'Architectural package: plans, product cutsheets, color board and association forms.'],
  ['HOA-RESUB', 'HOA Architectural Resubmittal', 'ea', 265.0, 0.42, 1, 'Revise and resubmit after ARC review comments.'],
]);

// ---------------------------------------------------------------------------
// Design Fees (7)
// ---------------------------------------------------------------------------

const design = untag('Design Fees', [
  ['DS-2D', '2D Concept Design', 'ea', 1950.0, 0.4, 1, 'Scaled 2D concept plan with two revision rounds.'],
  ['DS-3D', 'Full 3D Design with Night Render', 'ea', 4850.0, 0.4, 1, 'Photoreal 3D with day and night renders and a material board.'],
  ['DS-MASTER', 'Master Plan — Multi-Phase', 'ea', 7500.0, 0.4, 1, 'Phased master plan with budget bands and sequencing.'],
  ['DS-REV', 'Design Revision Round', 'ea', 650.0, 0.45, 1, 'Additional revision beyond the rounds included with the design.'],
  ['DS-CONSULT', 'On-Site Design Consultation', 'hr', 195.0, 0.45, 1, 'Designer walk-through with a conceptual markup.'],
  ['DS-VEN-BOARD', 'Material & Vendor Selection Board', 'ea', 850.0, 0.42, 1, 'Curated slab, paver and turf board with vendor sourcing.'],
  ['DS-ASBLT', 'As-Built Drawing Set', 'ea', 950.0, 0.42, 1, 'Record drawings reflecting field changes.'],
]);

// ---------------------------------------------------------------------------
// Validation + DB row assembly
// ---------------------------------------------------------------------------

const SECTIONS: CatalogSeed[] = [
  ...pavers,
  ...concrete,
  ...walls,
  ...pergolas,
  ...fire,
  ...water,
  ...kitchens,
  ...turf,
  ...irrigation,
  ...lighting,
  ...planting,
  ...demolition,
  ...grading,
  ...drainage,
  ...gravel,
  ...mobilization,
  ...permits,
  ...hoa,
  ...design,
];

const EXPECTED_ITEM_COUNT = 210;
const VALID_UNITS: readonly CatalogUnit[] = ['sqft', 'lf', 'ea', 'hr', 'day'];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const CATALOG_SEEDS: CatalogSeed[] = (() => {
  if (SECTIONS.length !== EXPECTED_ITEM_COUNT) {
    throw new Error(`catalog must have exactly ${EXPECTED_ITEM_COUNT} items, found ${SECTIONS.length}`);
  }
  const seen = new Set<string>();
  for (const item of SECTIONS) {
    if (seen.has(item.sku)) throw new Error(`duplicate sku: ${item.sku}`);
    seen.add(item.sku);
    if (!VALID_UNITS.includes(item.unit)) throw new Error(`invalid unit for ${item.sku}: ${item.unit}`);
    if (item.margin < 0.35 || item.margin > 0.45) {
      throw new Error(`margin ${item.margin} out of 0.35-0.45 range for ${item.sku}`);
    }
    if (item.unitPrice <= 0) throw new Error(`non-positive price for ${item.sku}`);
  }
  return SECTIONS;
})();

// Cost basis is computed here in TypeScript — never by the LLM (CLAUDE.md rule 1).
export const CATALOG_ROWS: CatalogInsertRow[] = CATALOG_SEEDS.map((item) => ({
  sku: item.sku,
  category: item.category,
  name: item.name,
  description: item.description,
  unit: item.unit,
  unit_price: item.unitPrice,
  unit_cost: round2(item.unitPrice * (1 - item.margin)),
  min_qty: item.minQty,
  notes: item.notes ?? null,
}));

/** Text used for catalog embeddings: name + description + category. */
export function embeddingText(item: {
  name: string;
  description: string | null;
  category: string;
}): string {
  return [item.name, item.description, item.category].filter(Boolean).join(' ');
}
