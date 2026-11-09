// ====================================================================
// مشروع نظارة «عين حذيفة» الذكية للمكفوفين - Ain Hudhaifa Smart Glasses
// ملف التصميم الهندسي الكامل ثلاثي الأبعاد بصيغة OpenSCAD
// مرخص مفتوح المصدر (Open Source 3D CAD Design)
// مصمم للأبعاد الفعلية: Seeed XIAO ESP32-C3 + VL53L1X ToF + LiPo 502030
// ====================================================================

$fn = 60; // دقة ونعومة الدوائر والانحناءات (Smooth Curves)

// ====================================================================
// 1. المتغيرات والتحكم في وضع العرض والطباعة (VIEW SELECTOR)
// ====================================================================
// غيّر هذه القيمة لاختيار وضع العرض المطلوب:
// "ALL_FOR_PRINT" : يفرش جميع القطع مسطحة على السطح جاهزة للتصدير إلى STL والطباعة
// "ASSEMBLED"     : يعرض النظارة كاملة مجمعة كما تبدو على وجه المستخدم
// "EXPLODED"      : يعرض المنظور التشريحي المفكك (جميع القطع متباعدة بالأسلاك)
// "FRAME_ONLY"    : يعرض هيكل الإطار الأمامي فقط
// "TEMPLES_ONLY"  : يعرض ذراعي النظارة فقط
// "COVERS_ONLY"   : يعرض الأغطية الكابسة فقط
// "CLIP_ON_KIT"   : يعرض الحوافظ الملحقة (كليبس) لمن يرتدي نظارة طبية حالية

VIEW_MODE = "ALL_FOR_PRINT"; 

// ====================================================================
// 2. الأبعاد الحقيقية للقطع الإلكترونية بالمليمتر (مع خلوص تركيب 0.4 مم)
// ====================================================================
// مستشعر الليزر VL53L1X
SENS_W = 13.5 + 0.4;
SENS_H = 10.5 + 0.4;
SENS_D = 2.6 + 0.3;
LENS_R = 2.2;         // نصف قطر فتحة عدسة الليزر
LENS_SEP = 4.2;       // المسافة بين مركزي فتحتي الليزر

// شريحة المعالج XIAO ESP32-C3
MCU_W = 21.0 + 0.5;
MCU_H = 17.5 + 0.5;
MCU_D = 3.5 + 0.4;

// بطارية الليثيوم 502030 (أو 402030)
BAT_L = 30.0 + 0.8;
BAT_W = 20.0 + 0.6;
BAT_D = 5.0 + 0.4;

// محرك الاهتزاز الحسي (Coin Motor 1027)
HAPTIC_R = 5.2;       // نصف القطر (قطر 10.4 مم)
HAPTIC_D = 2.8;       // السمك

// أبعاد الإطار العامة (Wayfarer Style)
FRAME_WIDTH = 142;
RIM_W = 50;
RIM_H = 42;
BRIDGE_W = 18;
TEMPLE_LEN = 135;
WALL = 1.6;           // سمك الجدران البلاستيكية للحماية والخفة

// ====================================================================
// 3. الموديلات الهندسية التفصيلية (MODULES)
// ====================================================================

// --- [أ] حلقة العدسة الواحدة (Rim) ---
module eye_rim() {
    difference() {
        hull() {
            translate([-RIM_W/2, -RIM_H/2, 0])
                cube([RIM_W, RIM_H, 4.5]);
            translate([-RIM_W/2 + 2, -RIM_H/2 + 2, 0])
                cube([RIM_W - 4, RIM_H - 4, 5.5]);
        }
        // فتحة العدسة الغائرة
        translate([-RIM_W/2 + 3, -RIM_H/2 + 3, -1])
            cube([RIM_W - 6, RIM_H - 6, 8]);
        // مجرى تثبيت العدسة (Bevel Groove)
        translate([-RIM_W/2 + 2, -RIM_H/2 + 2, 1.5])
            cube([RIM_W - 4, RIM_H - 4, 1.8]);
    }
}

// --- [ب] مجسم الإطار الأمامي الكامل مع تجويف المستشعر (Front Frame) ---
module front_frame() {
    difference() {
        union() {
            // العدسة اليمنى
            translate([BRIDGE_W/2 + RIM_W/2, 0, 0]) eye_rim();
            // العدسة اليسرى
            translate([- (BRIDGE_W/2 + RIM_W/2), 0, 0]) eye_rim();
            
            // جسر الأنف مع كتلة المستشعر المدمجة
            translate([- (SENS_W + WALL*2)/2, - (SENS_H + WALL*2)/2, 0])
                cube([SENS_W + WALL*2, SENS_H + WALL*2, SENS_D + WALL + 2]);
                
            // وسادات الأنف المريحة (Nose pads)
            translate([-8, -RIM_H/2 + 6, 0]) cube([3, 10, 4]);
            translate([5, -RIM_H/2 + 6, 0]) cube([3, 10, 4]);
            
            // مفاصل الذراع اليمنى واليسرى
            translate([FRAME_WIDTH/2 - 6, RIM_H/2 - 8, 0])
                cube([6, 8, 5.5]);
            translate([-FRAME_WIDTH/2, RIM_H/2 - 8, 0])
                cube([6, 8, 5.5]);
        }
        
        // تجويف مستشعر الليزر VL53L1X داخل جسر الأنف
        translate([- SENS_W/2, - SENS_H/2, WALL])
            cube([SENS_W, SENS_H, SENS_D + 4]);
            
        // فتحتا خروج واستقبال شعاع الليزر (الأمامية)
        translate([- LENS_SEP/2, 0, -1])
            cylinder(r = LENS_R, h = WALL + 2);
        translate([LENS_SEP/2, 0, -1])
            cylinder(r = LENS_R, h = WALL + 2);
            
        // مجرى الأسلاك العلوي المخفي (يمر من الأنف إلى الذراع الأيمن)
        translate([0, SENS_H/2 - 1, WALL + 0.5])
            cube([FRAME_WIDTH/2, 2.0, 2.0]);
            
        // ثقوب مسامير المفاصل (1.5 مم)
        translate([FRAME_WIDTH/2 - 3, RIM_H/2 - 4, -1])
            cylinder(r = 0.85, h = 8);
        translate([-FRAME_WIDTH/2 + 3, RIM_H/2 - 4, -1])
            cylinder(r = 0.85, h = 8);
    }
}

// --- [ج] غطاء حماية جسر الأنف وعدستي الليزر (Front Cover) ---
module bridge_cover() {
    difference() {
        hull() {
            translate([- (SENS_W + WALL*2 - 0.4)/2, - (SENS_H + WALL*2 - 0.4)/2, 0])
                cube([SENS_W + WALL*2 - 0.4, SENS_H + WALL*2 - 0.4, 1.8]);
            translate([- (SENS_W)/2, - (SENS_H)/2, 2.5])
                cube([SENS_W, SENS_H, 0.4]);
        }
        // فتحتا شعاع الليزر
        translate([- LENS_SEP/2, 0, -1])
            cylinder(r = LENS_R + 0.3, h = 5);
        translate([LENS_SEP/2, 0, -1])
            cylinder(r = LENS_R + 0.3, h = 5);
    }
    // ألسنة التثبيت بالكبس (Snap-fit tabs)
    translate([- SENS_W/2 + 1, - SENS_H/2 + 0.5, -1.8]) cube([1.5, 1.0, 1.8]);
    translate([SENS_W/2 - 2.5, - SENS_H/2 + 0.5, -1.8]) cube([1.5, 1.0, 1.8]);
    translate([- SENS_W/2 + 1, SENS_H/2 - 1.5, -1.8]) cube([1.5, 1.0, 1.8]);
    translate([SENS_W/2 - 2.5, SENS_H/2 - 1.5, -1.8]) cube([1.5, 1.0, 1.8]);
}

// --- [د] الذراع الأيمن الحامل للمعالج والبطارية ومنفذ الشحن ---
module right_temple() {
    arm_w = MCU_W + BAT_L + 8;
    arm_h = max(MCU_H, BAT_W) + WALL*2;
    arm_d = max(MCU_D, BAT_D) + WALL*2;
    
    difference() {
        // الهيكل الخارجي الانسيابي للذراع
        hull() {
            cube([arm_w, arm_h, arm_d]);
            // امتداد انحناء الأذن المريح
            translate([arm_w + 35, 2, arm_d/2 - 1.5])
                cube([25, 4.5, 3.0]);
            translate([TEMPLE_LEN - 5, -8, arm_d/2 - 1.5])
                cube([10, 4.0, 3.0]);
        }
        
        // تجويف شريحة XIAO ESP32-C3
        translate([WALL + 2, WALL, WALL])
            cube([MCU_W, MCU_H, MCU_D + 2]);
            
        // تجويف بطارية الليثيوم 502030
        translate([MCU_W + 5, (arm_h - BAT_W)/2, WALL])
            cube([BAT_L, BAT_W, BAT_D + 2]);
            
        // فتحة منفذ شحن USB-C (في الحافة السفلية)
        translate([WALL + 4, -1, WALL + 0.5])
            cube([9.4, WALL + 2, 3.6]);
            
        // مجرى خروج الأسلاك من المفصلة الأمامية
        translate([-1, arm_h/2 - 1.5, WALL + 1])
            cube([6, 3.0, 2.5]);
            
        // ثقب مسمار المفصلة الأمامية
        translate([3, arm_h - 3, -1])
            cylinder(r = 0.85, h = arm_d + 2);
    }
}

// --- [هـ] غطاء الذراع الأيمن الكابس (Temple Snap Cover) ---
module right_temple_cover() {
    cover_w = MCU_W + BAT_L + 6;
    cover_h = max(MCU_H, BAT_W) + WALL*2 - 0.4;
    
    difference() {
        cube([cover_w, cover_h, 1.5]);
        // شطف الحواف لمظهر أملس وأنيق
        translate([-1, -1, 1.2]) cube([cover_w + 2, 1.0, 1.0]);
        translate([-1, cover_h, 1.2]) cube([cover_w + 2, 1.0, 1.0]);
    }
    // ألسنة الكبس الجانبية
    translate([5, 0.4, -2.0]) cube([6, 0.8, 2.0]);
    translate([cover_w - 11, 0.4, -2.0]) cube([6, 0.8, 2.0]);
    translate([5, cover_h - 1.2, -2.0]) cube([6, 0.8, 2.0]);
    translate([cover_w - 11, cover_h - 1.2, -2.0]) cube([6, 0.8, 2.0]);
}

// --- [و] الذراع الأيسر الحامل لمحرك الاهتزاز (Left Temple) ---
module left_temple() {
    difference() {
        // هيكل متطابق بالانحناء لموازنة المظهر
        hull() {
            cube([65, 12, 5.5]);
            translate([65 + 35, 2, 1.5])
                cube([25, 6.0, 4.0]);
            translate([TEMPLE_LEN - 5, -8, 1.0])
                cube([10, 5.0, 3.5]);
        }
        // تجويف محرك الاهتزاز الحسي (خلف الأذن مباشرة)
        translate([85, 3.0, 1.0])
            cylinder(r = HAPTIC_R, h = HAPTIC_D + 2);
            
        // مجرى سلك الاهتزاز الدقيق
        translate([0, 5.0, 2.0])
            cube([85, 1.8, 1.8]);
            
        // ثقب مسمار المفصلة
        translate([3, 9, -1])
            cylinder(r = 0.85, h = 8);
    }
}

// --- [ز] حوافظ التركيب بالكبس على أي نظارة طبية حالية (Modular Clip-on Kit) ---
module clip_on_sensor_mount() {
    difference() {
        union() {
            // صندوق المستشعر
            cube([SENS_W + WALL*2, SENS_H + WALL*2, SENS_D + WALL]);
            // كليبس مرن للتشبيك بجسر أي نظارة طبية
            translate([0, -6, 0]) cube([SENS_W + WALL*2, 6, 2.2]);
            translate([0, -6, 0]) cube([SENS_W + WALL*2, 2, 8.0]);
            translate([0, -3, 6.5]) cube([SENS_W + WALL*2, 3, 1.5]);
        }
        // تجويف المستشعر
        translate([WALL, WALL, WALL])
            cube([SENS_W, SENS_H, SENS_D + 2]);
        // فتحتا الليزر
        translate([(SENS_W + WALL*2)/2 - LENS_SEP/2, (SENS_H + WALL*2)/2, -1])
            cylinder(r = LENS_R, h = WALL + 2);
        translate([(SENS_W + WALL*2)/2 + LENS_SEP/2, (SENS_H + WALL*2)/2, -1])
            cylinder(r = LENS_R, h = WALL + 2);
    }
}

// ====================================================================
// 4. منطق توزيع العرض حسب VIEW_MODE المختار
// ====================================================================

if (VIEW_MODE == "ALL_FOR_PRINT") {
    // مصفوفة مرتبة ومدمجة بالكامل داخل سرير طابعة 220x220 مم (الأبعاد الإجمالية: 142x160 مم فقط)
    // 1. الإطار الأمامي في الأعلى
    color("DimGray") translate([0, 52, 0]) front_frame();
    
    // 2. غطاء الجسر وعدسات الليزر
    color("LightGray") translate([0, 16, 0]) bridge_cover();
    
    // 3. الذراع الأيمن بالعرض (أفقي داخل حدود سرير الطباعة)
    color("DimGray") translate([-TEMPLE_LEN/2, -15, 0]) right_temple();
    
    // 4. الذراع الأيسر بالعرض (أفقي داخل حدود سرير الطباعة)
    color("DimGray") translate([-TEMPLE_LEN/2, -45, 0]) left_temple();
    
    // 5. غطاء الذراع الكابس
    color("LightGray") translate([-32, -75, 0]) right_temple_cover();
}
else if (VIEW_MODE == "ASSEMBLED") {
    // عرض النظارة مجمعة
    color("Black") front_frame();
    color("DimGray") translate([0, 0, SENS_D + WALL + 2]) bridge_cover();
    color("Black") translate([FRAME_WIDTH/2 - 6, RIM_H/2 - 8, 0]) rotate([0, 90, 0]) rotate([0, 0, -90]) right_temple();
    color("Black") translate([-FRAME_WIDTH/2, RIM_H/2 - 8, 0]) rotate([0, 90, 0]) rotate([0, 0, 90]) left_temple();
}
else if (VIEW_MODE == "EXPLODED") {
    // عرض تشريحي مفكك
    color("Black") front_frame();
    color("DodgerBlue") translate([0, 0, -25]) bridge_cover();
    color("Black") translate([FRAME_WIDTH/2 + 25, RIM_H/2, 0]) rotate([0, 0, 15]) right_temple();
    color("DeepSkyBlue") translate([FRAME_WIDTH/2 + 55, RIM_H/2, 15]) rotate([0, 0, 15]) right_temple_cover();
    color("Black") translate([-FRAME_WIDTH/2 - 25, RIM_H/2, 0]) rotate([0, 0, -15]) left_temple();
}
else if (VIEW_MODE == "FRAME_ONLY") {
    front_frame();
}
else if (VIEW_MODE == "TEMPLES_ONLY") {
    translate([30, 0, 0]) right_temple();
    translate([-30, 0, 0]) left_temple();
}
else if (VIEW_MODE == "COVERS_ONLY") {
    translate([0, 20, 0]) bridge_cover();
    translate([0, -20, 0]) right_temple_cover();
}
else if (VIEW_MODE == "CLIP_ON_KIT") {
    clip_on_sensor_mount();
}
