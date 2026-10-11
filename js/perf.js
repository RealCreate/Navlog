// Take-off and landing distances from the tables each aircraft SOP attaches ("TAKE OFF &
// LANDING CALCULATION — this calculation shall be performed as part of the flight dispatch
// preparation") and, for the Cessnas, the tables on the school's sheet. Values are interpolated
// in pressure altitude and temperature; outside the table the nearest edge is used and flagged.
// Corrections are applied exactly as printed next to each table.
//  - P2008 (SOP2518, 650 kg)         - P2002 (SOP2517 / sheet, 620 kg)
//  - P-Mentor (SOP2520, 720 kg)      - P2006T (SOP2521, 1180 kg) / P2006 NG (1290 kg, ISA columns)
//  - C172N (sheet: take-off 2300/2100/1900 lb)  - C172RG (sheet: take-off 2650/2500/2300 lb, landing 2650 lb)
//  - PA-28-181 (sheet: graphical charts) and PS-28 (no table in the SOP): read the chart / POH.

export const FT_PER_M = 3.28084;
const ALT10 = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
const ALT8 = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];

// Split rows written as [gr..., d50...] (same number of temperature columns each).
const tbl = (temps, alts, rows, extra = {}) => {
  const n = temps.length;
  return { temps, alts, gr: rows.map((r) => r.slice(0, n)), d50: rows.map((r) => r.slice(n, 2 * n)), ...extra };
};
// Cessna layout: per altitude [gr0, tot0, gr10, tot10, ...]
const cessna = (rows) => ({ gr: rows.map((r) => r.filter((_, i) => i % 2 === 0)), d50: rows.map((r) => r.filter((_, i) => i % 2 === 1)) });

const T4 = [-25, 0, 25, 50];
const C5 = [0, 10, 20, 30, 40];
const NG_DEV = [-40, -30, -20, -10, 0, 10, 20, 35];
// NG tables are printed ISA-40 … ISA-10, ISA+10, ISA+20, ISA+35, ISA: move the ISA column into place.
const ng = (rows) => rows.map((r) => { const f = (a) => [...a.slice(0, 4), a[7], ...a.slice(4, 7)]; return [...f(r.slice(0, 8)), ...f(r.slice(8, 16))]; });

export const PERF = {
  P2008: {
    unit: 'm', source: 'SOP2518 (AFM, Hoffman, 650 kg)',
    to: tbl(T4, ALT10, [
      [144, 182, 224, 272, 304, 379, 463, 557], [157, 198, 245, 297, 330, 412, 503, 605], [172, 216, 267, 324, 359, 448, 547, 658],
      [188, 236, 292, 354, 391, 487, 595, 717], [205, 258, 319, 387, 425, 530, 648, 780], [224, 283, 349, 423, 463, 578, 706, 850],
      [246, 309, 381, 463, 505, 630, 770, 927], [269, 339, 418, 507, 551, 687, 840, 1011], [295, 371, 458, 555, 601, 750, 917, 1104],
      [323, 407, 502, 609, 657, 819, 1002, 1205], [354, 446, 551, 668, 718, 895, 1095, 1318],
    ], { base: 'grass', corr: { hwM: -5, twM: 15, pavedGr: -0.10, slopeGr: 0.07 }, note: 'Lift-off 50 KIAS, 50 ft 61 KIAS, flaps T/O' }),
    ldg: tbl(T4, ALT10, [
      [149, 164, 179, 194, 358, 373, 388, 403], [154, 170, 186, 201, 363, 379, 395, 410], [160, 176, 192, 209, 369, 385, 401, 418],
      [166, 183, 200, 216, 375, 392, 409, 425], [172, 190, 207, 225, 381, 399, 416, 434], [179, 197, 215, 233, 388, 406, 424, 442],
      [186, 205, 223, 242, 395, 414, 432, 451], [193, 212, 232, 251, 402, 421, 441, 460], [200, 221, 241, 261, 410, 430, 450, 470],
      [208, 229, 250, 271, 417, 438, 459, 480], [217, 238, 260, 282, 426, 447, 469, 491],
    ], { base: 'grass', corr: { hwM: -4, twM: 13, pavedGr: -0.10, slopeGr: -0.03 }, note: 'Short final 54 KIAS, flaps LAND' }),
  },
  P2002: {
    unit: 'm', source: 'SOP2517 / P2002 sheet (AFM, Hoffman, 620 kg)',
    to: tbl(T4, ALT10, [
      [154, 203, 262, 331, 252, 335, 434, 553], [169, 223, 287, 364, 277, 368, 478, 610], [186, 245, 316, 401, 305, 405, 526, 672],
      [204, 269, 348, 442, 336, 446, 580, 742], [225, 296, 383, 487, 370, 492, 641, 820], [247, 327, 423, 538, 408, 543, 708, 907],
      [272, 360, 466, 594, 450, 600, 783, 1005], [300, 397, 515, 657, 498, 664, 867, 1114], [331, 439, 570, 727, 551, 735, 962, 1236],
      [366, 486, 631, 806, 610, 815, 1068, 1374], [405, 538, 700, 895, 676, 905, 1186, 1529],
    ], { base: 'grass', corr: { hwM: -2.5, twM: 10, pavedGr: -0.06, slopeGr: 0.05 }, note: 'Lift-off 42 KIAS, 50 ft 52 KIAS' }),
    ldg: tbl(T4, ALT10, [
      [141, 155, 170, 184, 277, 305, 333, 361], [146, 161, 176, 191, 288, 317, 345, 374], [152, 167, 183, 198, 298, 328, 358, 388],
      [158, 173, 189, 205, 309, 341, 372, 403], [164, 180, 196, 213, 321, 353, 386, 418], [170, 187, 204, 221, 333, 367, 400, 434],
      [176, 194, 212, 230, 346, 381, 415, 451], [183, 201, 220, 238, 359, 396, 432, 468], [190, 209, 228, 248, 373, 411, 449, 486],
      [198, 217, 237, 257, 388, 427, 466, 505], [205, 226, 247, 267, 403, 444, 484, 525],
    ], { base: 'grass', corr: { hwM: -5, twM: 11, pavedGr: -0.02, slopeGr: -0.025 }, note: 'Short final 51 KIAS' }),
  },
  PMENTOR: {
    unit: 'm', source: 'SOP2520 (AFM, 720 kg)',
    to: tbl([-25, -15, 0, 15, 30, 50], ALT10, [
      [240, 259, 288, 319, 351, 397, 366, 394, 439, 486, 535, 604], [257, 277, 309, 342, 376, 425, 392, 422, 470, 521, 573, 647],
      [276, 297, 331, 366, 403, 458, 420, 453, 504, 558, 615, 698], [296, 319, 355, 393, 433, 503, 450, 486, 541, 599, 659, 766],
      [317, 342, 381, 422, 470, 552, 483, 521, 580, 642, 716, 841], [341, 367, 409, 454, 516, 606, 519, 559, 623, 691, 787, 923],
      [366, 394, 439, 499, 567, 665, 557, 601, 669, 761, 865, 1014], [393, 424, 480, 549, 624, 730, 599, 646, 731, 837, 950, 1113],
      [423, 458, 529, 604, 685, 802, 644, 698, 805, 921, 1044, 1222], [457, 505, 582, 665, 753, 880, 696, 769, 887, 1013, 1148, 1341],
      [504, 557, 641, 731, 828, 967, 768, 848, 976, 1114, 1262, 1473],
    ], { base: 'paved', corr: {}, note: 'Runway dry, paved and level; VR 53 KIAS, V50ft 61 KIAS. The SOP gives no take-off corrections — wind, grass and slope: check the AFM' }),
    ldg: tbl([-25, -15, 0, 15, 30, 50], ALT10, [
      [153, 159, 169, 178, 187, 200, 415, 421, 431, 440, 449, 462], [159, 165, 175, 185, 194, 207, 421, 427, 437, 447, 456, 469],
      [165, 172, 181, 191, 201, 216, 427, 434, 443, 453, 463, 479], [171, 178, 188, 199, 209, 229, 433, 440, 450, 461, 471, 499],
      [177, 185, 195, 206, 219, 243, 439, 447, 457, 468, 485, 519], [184, 192, 203, 215, 233, 258, 446, 454, 465, 477, 505, 541],
      [191, 199, 211, 228, 248, 274, 453, 461, 473, 497, 526, 563], [199, 207, 223, 243, 263, 291, 461, 469, 489, 518, 547, 586],
      [206, 216, 237, 258, 280, 309, 468, 479, 510, 540, 570, 610], [215, 230, 252, 274, 297, 327, 479, 500, 531, 563, 594, 635],
      [230, 245, 268, 291, 315, 347, 499, 521, 554, 586, 618, 661],
    ], {
      base: 'paved',
      // per 3 kt: headwind −5 % ground / −3 % total; tailwind +20 % / +13 %; grass +20 % ground roll;
      // slope per 1 %: upslope −5/6/7 %, downslope +6/7/8 % ground roll at SL / 5000 / 10000 ft
      corr: { hwPct: [-0.05, -0.03, 3], twPct: [0.20, 0.13, 3], grassGr: 0.20, slopeUp: [0.05, 0.06, 0.07], slopeDown: [0.06, 0.07, 0.08] },
      note: 'VREF 58 KIAS, flaps LND',
    }),
  },
  P2006: {
    unit: 'm', source: 'SOP2521 (AFM, 1180 kg; landing at MTOW)',
    to: tbl(T4, ALT10, [
      [208, 258, 313, 374, 266, 331, 404, 485], [230, 284, 346, 413, 294, 366, 447, 537], [254, 315, 382, 457, 326, 406, 495, 595],
      [281, 348, 423, 505, 401, 499, 610, 733], [311, 385, 468, 560, 401, 499, 610, 733], [345, 427, 519, 620, 445, 555, 677, 814],
      [383, 474, 575, 688, 495, 617, 753, 906], [425, 526, 639, 764, 551, 686, 839, 1008], [472, 585, 710, 849, 614, 765, 934, 1123],
      [525, 650, 790, 945, 685, 853, 1042, 1253], [585, 724, 879, 1052, 764, 952, 1163, 1399],
    ], { base: 'grass', corr: { hwM: -2.5, twM: 10, pavedGr: -0.06, slopeGr: 0.05 }, note: 'Lift-off 65 KIAS, 50 ft 70 KIAS' }),
    ldg: tbl(T4, ALT10, [
      [183, 202, 220, 238, 288, 312, 335, 358], [190, 209, 228, 247, 297, 321, 345, 369], [197, 217, 237, 256, 306, 331, 356, 381],
      [204, 225, 245, 266, 325, 352, 379, 405], [212, 233, 255, 276, 325, 352, 379, 405], [220, 242, 264, 287, 335, 363, 391, 418],
      [228, 251, 275, 298, 346, 375, 403, 431], [237, 261, 285, 309, 357, 387, 416, 445], [246, 271, 296, 321, 368, 399, 430, 460],
      [256, 282, 308, 334, 380, 412, 444, 475], [266, 293, 320, 347, 393, 426, 459, 491],
    ], { base: 'grass', corr: { hwM: -5, twM: 11, pavedGr: -0.02, slopeGr: -0.025 }, note: 'Short final 70 KIAS' }),
  },
  P2006NG: {
    unit: 'm', source: 'SOP2521 2006NG charts (AFM, 1290 kg; landing at MTOW)',
    to: tbl(NG_DEV, ALT10, ng([
      [204, 224, 245, 268, 316, 342, 384, 292, 308, 339, 372, 406, 481, 521, 585, 443],
      [219, 241, 264, 288, 340, 368, 413, 314, 331, 365, 400, 438, 518, 562, 631, 473],
      [236, 259, 284, 310, 366, 397, 445, 338, 357, 393, 431, 472, 559, 605, 680, 506],
      [254, 279, 306, 334, 395, 427, 486, 364, 385, 424, 465, 509, 602, 653, 744, 542],
      [274, 301, 330, 360, 425, 462, 534, 392, 416, 458, 502, 549, 650, 707, 819, 581],
      [295, 325, 356, 388, 460, 508, 587, 423, 449, 494, 542, 593, 704, 779, 901, 623],
      [319, 350, 384, 419, 506, 559, 645, 456, 485, 534, 586, 640, 775, 858, 991, 698],
      [344, 378, 414, 453, 557, 615, 709, 502, 524, 577, 633, 693, 855, 945, 1091, 770],
      [372, 409, 448, 497, 614, 677, 780, 553, 567, 625, 685, 762, 942, 1042, 1202, 849],
      [402, 442, 491, 549, 676, 746, 859, 610, 614, 677, 752, 842, 1040, 1148, 1324, 937],
      [435, 483, 542, 605, 745, 821, 945, 672, 666, 740, 831, 930, 1147, 1267, 1460, 1034],
    ]), { isaDev: true, base: 'paved', corr: { hwM: -4, twM: 12, grassGr: 0.20, slopeM: 15 }, note: 'VR 67 KIAS, V50ft 73 KIAS; headwind −20 m / tailwind +60 m per 5 kt' }),
    ldg: tbl(NG_DEV, ALT10, ng([
      [217, 226, 234, 243, 261, 270, 283, 252, 413, 422, 430, 439, 457, 466, 479, 448],
      [223, 232, 241, 251, 269, 278, 291, 260, 419, 428, 437, 447, 465, 474, 487, 456],
      [230, 239, 249, 258, 277, 286, 300, 267, 426, 435, 445, 454, 473, 482, 496, 463],
      [237, 247, 256, 266, 285, 295, 314, 275, 433, 443, 452, 462, 481, 491, 513, 471],
      [244, 254, 264, 274, 294, 305, 329, 284, 440, 450, 460, 470, 490, 502, 532, 480],
      [252, 262, 272, 282, 303, 320, 346, 292, 448, 458, 468, 478, 500, 521, 553, 488],
      [260, 270, 281, 291, 319, 337, 363, 301, 456, 466, 477, 487, 519, 541, 574, 497],
      [268, 279, 289, 300, 335, 354, 381, 317, 464, 475, 485, 496, 540, 562, 596, 517],
      [276, 287, 298, 315, 352, 371, 400, 333, 472, 483, 494, 514, 561, 584, 619, 537],
      [285, 296, 312, 331, 370, 390, 420, 351, 481, 492, 511, 535, 582, 606, 642, 558],
      [294, 309, 328, 348, 389, 410, 441, 369, 490, 506, 531, 556, 605, 630, 667, 580],
    ]), { isaDev: true, base: 'paved', corr: { hwM: -4, twM: 12, grassGr: 0.20, slopeM: -10 }, note: 'Approach 72 KIAS; headwind −20 m / tailwind +60 m per 5 kt' }),
  },
  C172: {
    unit: 'ft', source: 'C172N sheet (POH fig. 5-4, short field)',
    // take-off: per weight, temperature columns 0–40 °C
    toByWeight: [
      [2300, { temps: C5, alts: ALT8, ...cessna([
        [720, 1300, 775, 1390, 835, 1490, 895, 1590, 960, 1700], [790, 1420, 850, 1525, 915, 1630, 980, 1745, 1050, 1865],
        [865, 1555, 930, 1670, 1000, 1790, 1075, 1915, 1155, 2055], [950, 1710, 1025, 1835, 1100, 1970, 1185, 2115, 1270, 2265],
        [1045, 1880, 1125, 2025, 1210, 2175, 1300, 2335, 1400, 2510], [1150, 2075, 1240, 2240, 1335, 2410, 1435, 2595, 1540, 2795],
        [1265, 2305, 1365, 2485, 1475, 2680, 1585, 2895, 1705, 3125], [1400, 2565, 1510, 2770, 1630, 3000, 1755, 3245, 1890, 3515],
        [1550, 2870, 1675, 3110, 1805, 3375, 1945, 3670, 2095, 3990]]) }],
      [2100, { temps: C5, alts: ALT8, ...cessna([
        [585, 1070, 630, 1140, 680, 1220, 725, 1300, 780, 1390], [640, 1165, 690, 1245, 740, 1330, 795, 1420, 850, 1520],
        [700, 1270, 755, 1360, 810, 1455, 870, 1555, 935, 1665], [770, 1390, 830, 1490, 890, 1595, 955, 1710, 1025, 1830],
        [845, 1525, 910, 1640, 980, 1755, 1050, 1880, 1130, 2015], [930, 1680, 1000, 1805, 1075, 1935, 1155, 2075, 1240, 2230],
        [1025, 1850, 1100, 1990, 1185, 2140, 1275, 2300, 1370, 2475], [1130, 2050, 1215, 2210, 1310, 2380, 1410, 2560, 1515, 2755],
        [1245, 2275, 1345, 2460, 1450, 2655, 1560, 2865, 1680, 3090]]) }],
      [1900, { temps: C5, alts: ALT8, ...cessna([
        [470, 865, 505, 920, 540, 985, 580, 1045, 620, 1115], [515, 940, 550, 1005, 590, 1070, 635, 1140, 680, 1215],
        [560, 1025, 605, 1095, 645, 1170, 695, 1245, 745, 1330], [615, 1115, 660, 1195, 710, 1275, 760, 1365, 815, 1455],
        [670, 1220, 725, 1305, 780, 1400, 835, 1495, 895, 1595], [740, 1340, 795, 1435, 855, 1535, 920, 1640, 985, 1755],
        [810, 1470, 875, 1575, 940, 1690, 1010, 1810, 1085, 1940], [895, 1620, 965, 1740, 1035, 1865, 1115, 2000, 1195, 2145],
        [985, 1790, 1065, 1925, 1145, 2065, 1230, 2220, 1320, 2385]]) }],
    ],
    toCorr: { base: 'paved', corr: { hwPctAll: [-0.10, 9], twPctAll: [0.10, 2, 10], grassOfGr: 0.15 }, note: 'Short field, flaps up; lift-off 52/50/47 KIAS. Above 3000 ft lean for max RPM' },
    ldg: null, ldgNote: 'The C172N landing table is not on the school sheet — read it from the POH (section 5)',
  },
  C172RG: {
    unit: 'ft', source: 'C172RG sheet (POH, short field)',
    toByWeight: [
      [2650, { temps: C5, alts: ALT8, ...cessna([
        [955, 1605, 1025, 1715, 1100, 1835, 1175, 1965, 1260, 2100], [1040, 1755, 1120, 1880, 1200, 2015, 1285, 2155, 1375, 2310],
        [1140, 1925, 1225, 2065, 1315, 2215, 1410, 2380, 1510, 2550], [1250, 2120, 1340, 2280, 1440, 2450, 1545, 2630, 1655, 2830],
        [1370, 2345, 1475, 2525, 1585, 2715, 1700, 2930, 1820, 3160], [1505, 2600, 1620, 2805, 1740, 3030, 1870, 3280, 2005, 3550],
        [1660, 2905, 1785, 3145, 1920, 3405, 2065, 3700, 2215, 4025], [1830, 3265, 1970, 3545, 2120, 3865, 2280, 4220, 2450, 4630],
        [2025, 3700, 2180, 4045, 2350, 4440, 2530, 4895, 2720, 5430]]) }],
      [2500, { temps: C5, alts: ALT8, ...cessna([
        [835, 1400, 895, 1495, 960, 1595, 1025, 1705, 1100, 1820], [910, 1525, 975, 1635, 1045, 1745, 1120, 1865, 1200, 1995],
        [995, 1670, 1070, 1790, 1145, 1915, 1225, 2050, 1315, 2195], [1090, 1835, 1170, 1965, 1255, 2105, 1345, 2260, 1440, 2420],
        [1195, 2015, 1280, 2165, 1375, 2325, 1475, 2500, 1580, 2685], [1310, 2230, 1410, 2400, 1515, 2580, 1625, 2780, 1740, 2990],
        [1440, 2470, 1550, 2665, 1665, 2875, 1790, 3105, 1920, 3355], [1585, 2760, 1710, 2980, 1840, 3230, 1975, 3500, 2120, 3800],
        [1755, 3095, 1890, 3360, 2035, 3655, 2185, 3980, 2350, 4350]]) }],
      [2300, { temps: C5, alts: ALT8, ...cessna([
        [690, 1160, 740, 1240, 790, 1320, 845, 1405, 905, 1500], [750, 1265, 805, 1350, 860, 1440, 920, 1535, 985, 1635],
        [820, 1380, 880, 1475, 940, 1575, 1010, 1680, 1080, 1795], [895, 1505, 960, 1610, 1030, 1725, 1105, 1845, 1180, 1970],
        [980, 1650, 1050, 1770, 1130, 1895, 1210, 2025, 1295, 2170], [1075, 1815, 1155, 1950, 1240, 2090, 1325, 2240, 1420, 2400],
        [1180, 2005, 1265, 2150, 1360, 2310, 1460, 2485, 1565, 2670], [1295, 2220, 1395, 2385, 1500, 2570, 1610, 2765, 1725, 2980],
        [1430, 2465, 1540, 2660, 1655, 2875, 1775, 3105, 1905, 3355]]) }],
    ],
    toCorr: { base: 'paved', corr: { hwPctAll: [-0.10, 9], twPctAll: [0.10, 2, 10], grassOfGr: 0.15 }, note: 'Short field, flaps up, cowl flaps open; lift-off 58/56/54 KIAS' },
    ldg: { temps: C5, alts: ALT8, ...cessna([
      [590, 1290, 615, 1325, 635, 1355, 660, 1390, 680, 1425], [615, 1325, 635, 1355, 660, 1395, 680, 1425, 705, 1460],
      [635, 1355, 660, 1395, 685, 1430, 705, 1465, 730, 1500], [660, 1395, 685, 1430, 710, 1470, 735, 1505, 760, 1545],
      [685, 1430, 710, 1470, 735, 1510, 760, 1545, 785, 1585], [710, 1470, 740, 1515, 765, 1550, 790, 1590, 815, 1630],
      [740, 1515, 765, 1555, 795, 1595, 820, 1635, 850, 1680], [770, 1560, 795, 1600, 825, 1645, 850, 1685, 880, 1725],
      [800, 1605, 825, 1645, 855, 1690, 885, 1735, 915, 1780]]), base: 'paved', corr: { hwPctAll: [-0.10, 9], twPctAll: [0.10, 2, 10], grassOfGr: 0.40 }, note: 'Short field, flaps 30°, 2650 lb, 63 KIAS' },
  },
  PA28: { manual: 'PA-28-181: the take-off and landing ground rolls are graphical charts on the sheet — read them with the values below' },
  PS28: { manual: 'PS-28: the SOP has no take-off/landing tables — use the POH section 5' },
};

/** ISA temperature at a pressure altitude (°C). */
export const isaTemp = (paFt) => 15 - 2 * (paFt / 1000);
/** Pressure altitude from elevation and QNH (27 ft per hPa). */
export const pressureAlt = (elevFt, qnh) => Math.round(elevFt + (1013 - (qnh || 1013)) * 27);

function interp1(xs, x) {
  if (x <= xs[0]) return [0, 0, x < xs[0]];
  if (x >= xs[xs.length - 1]) return [xs.length - 1, 0, x > xs[xs.length - 1]];
  let i = 0; while (xs[i + 1] < x) i++;
  return [i, (x - xs[i]) / (xs[i + 1] - xs[i]), false];
}
function bilinear(t, grid, pa, temp) {
  const [ia, fa, oa] = interp1(t.alts, pa), [it, ft, ot] = interp1(t.temps, temp);
  const g = (a, b) => grid[Math.min(a, grid.length - 1)][Math.min(b, grid[0].length - 1)];
  const v0 = g(ia, it) + (g(ia, it + 1) - g(ia, it)) * ft;
  const v1 = g(ia + 1, it) + (g(ia + 1, it + 1) - g(ia + 1, it)) * ft;
  return { v: v0 + (v1 - v0) * fa, out: oa || ot };
}
function lookup(t, pa, temp) {
  const a = bilinear(t, t.gr, pa, temp), b = bilinear(t, t.d50, pa, temp);
  return { gr: a.v, d50: b.v, out: a.out || b.out };
}

/**
 * Distances for one phase. cond: { pa, oat, wind (+ head / − tail, kt), surface: 'paved'|'grass',
 *   slope (% , + upslope), weight (lb, Cessna take-off) }. Returns distances in the table unit.
 */
export function phaseDistance(table, cond) {
  const temp = table.isaDev ? cond.oat - isaTemp(cond.pa) : cond.oat;
  const r = lookup(table, Math.max(0, cond.pa), temp);
  let gr = r.gr, d50 = r.d50;
  const c = table.corr || {}, steps = [];
  const hw = Math.max(0, cond.wind || 0), tw = Math.max(0, -(cond.wind || 0));
  // wind
  if (c.hwM && hw) { gr += c.hwM * hw; d50 += c.hwM * hw; steps.push(`headwind ${hw} kt × ${c.hwM} ${table.unit || 'm'}`); }
  if (c.twM && tw) { gr += c.twM * tw; d50 += c.twM * tw; steps.push(`tailwind ${tw} kt × +${c.twM} ${table.unit || 'm'}`); }
  if (c.hwPct && hw) { const k = hw / c.hwPct[2]; gr *= 1 + c.hwPct[0] * k; d50 *= 1 + c.hwPct[1] * k; steps.push(`headwind ${hw} kt`); }
  if (c.twPct && tw) { const k = tw / c.twPct[2]; gr *= 1 + c.twPct[0] * k; d50 *= 1 + c.twPct[1] * k; steps.push(`tailwind ${tw} kt`); }
  if (c.hwPctAll && hw) { const f = 1 + c.hwPctAll[0] * (hw / c.hwPctAll[1]); gr *= f; d50 *= f; steps.push(`headwind ${hw} kt (−10 % per 9 kt)`); }
  if (c.twPctAll && tw) { const f = 1 + c.twPctAll[0] * (tw / c.twPctAll[1]); gr *= f; d50 *= f; steps.push(`tailwind ${tw} kt (+10 % per 2 kt)`); }
  // surface
  const grass = cond.surface === 'grass';
  if (table.base === 'grass' && !grass && c.pavedGr) { gr *= 1 + c.pavedGr; steps.push(`paved ${Math.round(c.pavedGr * 100)} % ground roll`); }
  if (table.base === 'paved' && grass && c.grassGr) { gr *= 1 + c.grassGr; steps.push(`grass +${Math.round(c.grassGr * 100)} % ground roll`); }
  if (table.base === 'paved' && grass && c.grassOfGr) { const add = gr * c.grassOfGr; gr += add; d50 += add; steps.push(`grass +${Math.round(c.grassOfGr * 100)} % of the ground roll`); }
  // slope
  const s = cond.slope || 0;
  if (s && c.slopeGr) { gr *= 1 + c.slopeGr * s; steps.push(`slope ${s > 0 ? '+' : ''}${s} %`); }
  if (s && c.slopeM) { gr += c.slopeM * s; steps.push(`slope ${s > 0 ? '+' : ''}${s} %`); }
  if (s && c.slopeUp) {
    const f = (arr) => { const [i, k] = interp1([0, 5000, 10000], cond.pa); return arr[i] + ((arr[i + 1] ?? arr[i]) - arr[i]) * k; };
    gr *= s > 0 ? 1 - f(c.slopeUp) * s : 1 + f(c.slopeDown) * -s; steps.push(`slope ${s > 0 ? '+' : ''}${s} %`);
  }
  return { gr: Math.max(0, Math.round(gr)), d50: Math.max(0, Math.round(d50)), out: r.out, steps, temp };
}

/** Take-off and landing for an aircraft type at one aerodrome. */
export function performance(typeId, cond) {
  const p = PERF[typeId];
  if (!p) return null;
  if (p.manual) return { manual: p.manual };
  let to;
  if (p.toByWeight) {
    // Cessna: tables by weight; interpolate between the bracketing weights (above the top → top table, flagged)
    const ws = p.toByWeight.map(([w]) => w).sort((a, b) => a - b);
    const tables = Object.fromEntries(p.toByWeight);
    const w = Math.min(Math.max(cond.weight || ws[ws.length - 1], ws[0]), ws[ws.length - 1]);
    let i = 0; while (i < ws.length - 2 && ws[i + 1] < w) i++;
    const lo = ws[i], hi = ws[i + 1];
    const a = phaseDistance({ ...tables[lo], ...p.toCorr, unit: p.unit }, cond), b = phaseDistance({ ...tables[hi], ...p.toCorr, unit: p.unit }, cond);
    const k = hi === lo ? 0 : (w - lo) / (hi - lo);
    to = { gr: Math.round(a.gr + (b.gr - a.gr) * k), d50: Math.round(a.d50 + (b.d50 - a.d50) * k), out: a.out || b.out || (cond.weight || 0) > ws[ws.length - 1], steps: a.steps, note: p.toCorr.note };
  } else {
    to = { ...phaseDistance({ ...p.to, unit: p.unit }, cond), note: p.to.note };
  }
  const ldg = p.ldg ? { ...phaseDistance({ ...p.ldg, unit: p.unit }, cond), note: p.ldg.note } : { manual: p.ldgNote };
  return { unit: p.unit, source: p.source, to, ldg };
}
