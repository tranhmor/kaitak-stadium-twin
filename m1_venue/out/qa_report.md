# M1 QA report

Built 2026-11-27T19:10:56+08:00 from `Kai_Tak_Peak_Routes.blend` (sha256 `3d59faf2714e873d…`), config v0.1.

**14 passed, 0 failed, 14 notes.**

- [PASS] 51 zones with unique IDs: 12 concourse, 3 floor, 4 gate, 15 portal, 15 seating, 2 tunnel
- [PASS] every zone is one valid polygon with area > 1 m²
- [PASS] zones do not overlap (largest pairwise overlap 0.00 m²)
- [PASS] every zone lies inside the stadium envelope plus the gate forecourt depth
- [PASS] zone graph has no isolated zone
- [PASS] every occupied zone reaches at least 2 gates (min 4, max 4)
- [WARN] OSM gate points within 5 m of the model facade: F 6.69 m, E 1.89 m, D 1.39 m, C 3.5 m; gate zones are placed on the model facade along the ray through the OSM point
- [PASS] walkable area is one connected polygon (19,428 m², 1 holes)
- [PASS] every exit area lies on the walkable polygon
- [PASS] spawn points match capacity: 9,899 people (3,799 lower tier, 6,100 floor)
- [PASS] venue_lite.glb is 2.4 MB (limit 30 MB)
- [PASS] 52 zone boundaries, 34 with a counting line; 17 displays
- [PASS] 4 zones have no camera and must be estimated by M3: L2-W-C03, L2-W-C06, L2-W-C09, L2-W-C12
- [PASS] 4 seating zones are behind the stage video wall and closed: L2-W-S01, L2-W-S02, L2-W-S03, L2-W-S04
- [PASS] stage preset `north_end` (original, provisional); gate load with everyone at the nearest gate: F 2,013, E 1,700, D 742, C 5,444; gate to close in the demo: D, next to the busiest gate C
- [WARN] assumed `concourse_width_m` = 17.0 (width of the 'East concourse' interior set in the .blend (17 x 55 m))
- [WARN] assumed `concourse_inset_m` = 0.5 (assumed facade thickness)
- [WARN] assumed `portal_width_m` = 3.0 (assumed; no vomitories in the .blend)
- [WARN] assumed `gate_width_m` = 8.0 (assumed; OSM gives gate points only)
- [WARN] assumed `gate_depth_m` = 12.0 (assumed gate forecourt depth)
- [WARN] assumed `gate_flow_share` = 0.4 (assumed share of the gate width that passes people (doors, barriers, stewards))
- [WARN] assumed `specific_flow_pps_per_m` = 1.3 (design flow per metre of clear width (SFPE handbook order of magnitude; to cite))
- [WARN] assumed `jam_density_ppm2` = 4.0 (assumed density at which a zone accepts nobody)
- [WARN] assumed `tunnel_width_m` = 5.0 (assumed; no pitch tunnels in the .blend)
- [WARN] assumed `tunnel_angles_deg` = [128.0, 232.0] (assumed, at the bowl corners)
- [WARN] assumed `stage_side` = north (.blend stage deck at y -160..-137 (roadmap text says south; to confirm))
- [WARN] zone IDs are provisional; `official_sections` is empty until the official seating map is mapped
- [WARN] source model status: Photo-referenced architectural study. Interior layouts, stage, landscape, harbour backdrop and sign placement are interpretive. No surveyed indoor or emergency circulation model.

## Zones

| ID | Type | Area m² | Capacity | Camera | Neighbours |
|---|---|---|---|---|---|
| L2-W-C01 | concourse | 577.0 | 0 | yes | 2 |
| L2-W-C02 | concourse | 574.5 | 0 | yes | 4 |
| L2-W-C03 | concourse | 569.0 | 0 | no | 5 |
| L2-W-C04 | concourse | 546.5 | 0 | yes | 3 |
| L2-W-C05 | concourse | 516.8 | 0 | yes | 4 |
| L2-W-C06 | concourse | 476.9 | 0 | no | 4 |
| L2-W-C07 | concourse | 462.0 | 0 | yes | 4 |
| L2-W-C08 | concourse | 491.6 | 0 | yes | 3 |
| L2-W-C09 | concourse | 532.3 | 0 | no | 4 |
| L2-W-C10 | concourse | 566.2 | 0 | yes | 5 |
| L2-W-C11 | concourse | 584.4 | 0 | yes | 4 |
| L2-W-C12 | concourse | 591.4 | 0 | no | 2 |
| L2-W-G-F | gate | 99.8 | 0 | yes | 1 |
| L2-W-G-E | gate | 99.0 | 0 | yes | 1 |
| L2-W-G-D | gate | 98.9 | 0 | yes | 1 |
| L2-W-G-C | gate | 99.2 | 0 | yes | 1 |
| L0-W-T01 | tunnel | 177.7 | 0 | yes | 2 |
| L0-W-T02 | tunnel | 174.9 | 0 | yes | 2 |
| L2-W-S01 | seating | 226.5 | 0 | yes | 1 |
| L2-W-P01 | portal | 68.6 | 0 | yes | 2 |
| L2-W-S02 | seating | 226.2 | 0 | yes | 1 |
| L2-W-P02 | portal | 67.9 | 0 | yes | 2 |
| L2-W-S03 | seating | 179.7 | 0 | yes | 1 |
| L2-W-P03 | portal | 67.1 | 0 | yes | 2 |
| L2-W-S04 | seating | 187.2 | 0 | yes | 1 |
| L2-W-P04 | portal | 62.0 | 0 | yes | 2 |
| L2-W-S05 | seating | 226.5 | 237 | yes | 1 |
| L2-W-P05 | portal | 55.9 | 0 | yes | 2 |
| L2-W-S06 | seating | 227.7 | 366 | yes | 1 |
| L2-W-P06 | portal | 47.9 | 0 | yes | 2 |
| L2-W-S07 | seating | 225.0 | 366 | yes | 1 |
| L2-W-P07 | portal | 40.6 | 0 | yes | 2 |
| L2-W-S08 | seating | 225.3 | 366 | yes | 1 |
| L2-W-P08 | portal | 37.8 | 0 | yes | 3 |
| L2-W-S09 | seating | 227.8 | 365 | yes | 1 |
| L2-W-P09 | portal | 38.1 | 0 | yes | 2 |
| L2-W-S10 | seating | 228.1 | 371 | yes | 1 |
| L2-W-P10 | portal | 43.1 | 0 | yes | 2 |
| L2-W-S11 | seating | 221.5 | 371 | yes | 1 |
| L2-W-P11 | portal | 50.5 | 0 | yes | 2 |
| L2-W-S12 | seating | 184.5 | 312 | yes | 1 |
| L2-W-P12 | portal | 58.7 | 0 | yes | 2 |
| L2-W-S13 | seating | 190.1 | 313 | yes | 1 |
| L2-W-P13 | portal | 66.8 | 0 | yes | 2 |
| L2-W-S14 | seating | 219.1 | 366 | yes | 1 |
| L2-W-P14 | portal | 72.1 | 0 | yes | 2 |
| L2-W-S15 | seating | 220.2 | 366 | yes | 1 |
| L2-W-P15 | portal | 74.0 | 0 | yes | 2 |
| L0-W-F01 | floor | 3336.5 | 2013 | yes | 2 |
| L0-W-F02 | floor | 2277.2 | 2074 | yes | 2 |
| L0-W-F03 | floor | 2509.6 | 2013 | yes | 2 |
