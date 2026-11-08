// ====================================================================
// Ain Hudhaifa Smart Glasses - 3D Printable Parametric CAD Model (OpenSCAD)
// Model: Full Smart Frame + Modular Clip-on Kit
// Engineered for: Seeed Studio XIAO ESP32-C3 + VL53L1X ToF + 502030 LiPo
// ====================================================================

$fn = 60; // Smooth curve resolution

// --- Real Component Dimensions (in mm) with 0.4mm tolerance ---
VL53_WIDTH  = 13.5 + 0.5;
VL53_HEIGHT = 10.5 + 0.5;
VL53_THICK  = 2.6 + 0.4;
LENS_RADIUS = 2.2;
LENS_SPACING = 4.2;

XIAO_WIDTH  = 21.0 + 0.6;
XIAO_HEIGHT = 17.5 + 0.6;
XIAO_THICK  = 3.5 + 0.5;

BATTERY_LEN   = 30.0 + 1.0;
BATTERY_WIDTH = 20.0 + 0.8;
BATTERY_THICK = 5.0 + 0.5;

WALL = 1.5; // Enclosure wall thickness

// --- 1. Nose Bridge Sensor Housing (VL53L1X) ---
module sensor_bridge_mount() {
    difference() {
        // Outer case
        hull() {
            translate([- (VL53_WIDTH + WALL*2)/2, - (VL53_HEIGHT + WALL*2)/2, 0])
                cube([VL53_WIDTH + WALL*2, VL53_HEIGHT + WALL*2, VL53_THICK + WALL]);
            // Upper chamfer for aerodynamics and aesthetic
            translate([- (VL53_WIDTH + WALL)/2, - (VL53_HEIGHT + WALL)/2, VL53_THICK + WALL + 1])
                cube([VL53_WIDTH + WALL, VL53_HEIGHT + WALL, 0.5]);
        }
        
        // Inner sensor pocket
        translate([- VL53_WIDTH/2, - VL53_HEIGHT/2, WALL])
            cube([VL53_WIDTH, VL53_HEIGHT, VL53_THICK + 2]);
            
        // Dual laser emitter/receiver eyelets (Front facing)
        translate([- LENS_SPACING/2, 0, -1])
            cylinder(r = LENS_RADIUS, h = WALL + 2);
        translate([LENS_SPACING/2, 0, -1])
            cylinder(r = LENS_RADIUS, h = WALL + 2);
            
        // Top wire channel exit (for 4 silicone wires 30AWG)
        translate([-4, (VL53_HEIGHT/2), WALL])
            cube([8, WALL + 2, 3]);
    }
}

// --- 2. Temple Electronics Enclosure (Right Arm) ---
module temple_electronics_case() {
    total_len = XIAO_WIDTH + BATTERY_LEN + 4;
    case_w = max(XIAO_HEIGHT, BATTERY_WIDTH) + WALL*2;
    case_h = max(XIAO_THICK, BATTERY_THICK) + WALL*2;
    
    difference() {
        // Sleek aerodynamic outer arm housing
        hull() {
            translate([0, -case_w/2, 0])
                cube([total_len, case_w, case_h]);
            // Tapered end towards ear curve
            translate([total_len + 15, -case_w/4, case_h/4])
                cube([1, case_w/2, case_h/2]);
        }
        
        // XIAO ESP32-C3 Pocket
        translate([WALL, -XIAO_HEIGHT/2, WALL])
            cube([XIAO_WIDTH, XIAO_HEIGHT, XIAO_THICK + 1]);
            
        // LiPo 502030 Battery Pocket
        translate([XIAO_WIDTH + 2, -BATTERY_WIDTH/2, WALL])
            cube([BATTERY_LEN, BATTERY_WIDTH, BATTERY_THICK + 1]);
            
        // USB-C Charging Port Slot (Bottom facing)
        translate([WALL + 2, -case_w/2 - 1, WALL + 0.5])
            cube([9.5, WALL + 2, 3.8]);
            
        // Internal wire passway
        translate([0, -3, WALL + 1])
            cube([total_len, 6, 2]);
    }
}

// --- Render preview ---
translate([0, 30, 0]) sensor_bridge_mount();
translate([0, -15, 0]) temple_electronics_case();
