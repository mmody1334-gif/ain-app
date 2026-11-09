// ====================================================================
// مشروع نظارة «عين حذيفة» الذكية للمكفوفين - الإصدار الهندسي المطور v2.0
// Ain Hudhaifa Smart Glasses - Symmetrical Ergonomic Design (v2.0)
// تصميم احترافي متناظر 100%، أذرع متطابقة في المظهر، أغطية كابسة كاملة (Snap-on)
// مصمم خصيصاً ليناسب سرير طابعة Creality (220x220 مم)
// ====================================================================

$fn = 60; // دقة ونعومة الدوائر والانحناءات

// ====================================================================
// 1. اختيار وضع العرض (VIEW SELECTOR)
// ====================================================================
// "ALL_FOR_PRINT" : فرش جميع القطع مسطحة على السرير (220x220 مم) للطباعة
// "ASSEMBLED"     : عرض النظارة مجمعة ومغلقة بالأغطية كما تبدو على الوجه
// "EXPLODED"      : عرض تشريحي مفكك يوضح الأغطية والقطع الداخلية
// "FRAME_ONLY"    : الإطار الأمامي فقط
// "TEMPLES_ONLY"  : الذراعان المتناظران فقط
// "COVERS_ONLY"   : الأغطية الكابسة فقط

VIEW_MODE = "ALL_FOR_PRINT";

// ====================================================================
// 2. المقاسات الدقيقة للقطع الإلكترونية (بالمليمتر مع خلوص 0.4 مم)
// ====================================================================
// مستشعر الليزر VL53L1X
SENS_W   = 13.5 + 0.5;
SENS_H   = 10.5 + 0.5;
SENS_D   = 2.6 + 0.4;
LENS_R   = 2.2;        // نصف قطر فتحة عدسة الليزر
LENS_SEP = 4.2;        // المسافة بين مركزي فتحتي الليزر

// معالج XIAO ESP32-C3
MCU_W    = 21.2 + 0.4;
MCU_H    = 17.8 + 0.4;
MCU_D    = 3.6 + 0.3;

// بطارية الليثيوم (سواء 502030 أو بطارية الفيب النحيفة)
BAT_L    = 32.0 + 0.8;
BAT_W    = 18.0 + 0.6;
BAT_D    = 5.2 + 0.4;

// محرك الاهتزاز الحسي (1027 Coin Motor)
HAPTIC_R = 5.2;        // نصف القطر (قطر 10.4 مم)
HAPTIC_D = 2.9;

// مفتاح التشغيل متناهي الصغر (Micro Slide Switch SS12D00)
SW_L     = 8.8 + 0.4;
SW_W     = 4.4 + 0.4;
SW_H     = 4.0 + 0.3;

// أبعاد النظارة الكلاسيكية (Wayfarer Balanced Dimensions)
FRAME_W    = 142.0;    // عرض الإطار الكلي
LENS_W     = 50.0;     // عرض العدسة
LENS_H     = 42.0;     // ارتفاع العدسة
BRIDGE_W   = 18.0;     // عرض جسر الأنف
TEMPLE_L   = 136.0;    // طول الذراع
ARM_H_MAX  = 16.5;     // أقصى ارتفاع للذراع عند الصدغ
ARM_H_MIN  = 6.0;      // ارتفاع نهاية الذراع عند الأذن
ARM_THICK  = 6.4;      // سمك الذراع الخارجي (موحد لكلا الذراعين للمظهر الطبيعي)
WALL       = 1.5;      // سمك جدار الحماية

// ====================================================================
// 3. الموديلات الهندسية (MODULES)
// ====================================================================

// --- [1] حلقة العدسة الأنيقة مع شطف الحواف (Lens Rim) ---
module stylish_rim() {
    difference() {
        hull() {
            translate([-LENS_W/2, -LENS_H/2, 0])
                cube([LENS_W, LENS_H, 4.2]);
            translate([-LENS_W/2 + 2, -LENS_H/2 + 2, 0])
                cube([LENS_W - 4, LENS_H - 4, 5.0]);
        }
        // تجويف العدسة
        translate([-LENS_W/2 + 3, -LENS_H/2 + 3, -1])
            cube([LENS_W - 6, LENS_H - 6, 8.0]);
        // شطف الحافة الداخلية لمظهر انسيابي
        translate([-LENS_W/2 + 2, -LENS_H/2 + 2, 1.4])
            cube([LENS_W - 4, LENS_H - 4, 1.6]);
    }
}

// --- [2] الإطار الأمامي الكامل مع تجويف المستشعر المخفي داخلياً ---
module front_frame_v2() {
    difference() {
        union() {
            // العدسة اليمنى واليسرى
            translate([BRIDGE_W/2 + LENS_W/2, 0, 0]) stylish_rim();
            translate([- (BRIDGE_W/2 + LENS_W/2), 0, 0]) stylish_rim();
            
            // جسر الأنف الانسيابي (أملس من الخارج)
            hull() {
                translate([- (SENS_W + WALL*2)/2, - (SENS_H + WALL*2)/2, 0])
                    cube([SENS_W + WALL*2, SENS_H + WALL*2, SENS_D + WALL + 1.8]);
                translate([- BRIDGE_W/2, - LENS_H/2 + 10, 0])
                    cube([BRIDGE_W, 6, 4.2]);
            }
            
            // وسادات الأنف المريحة
            translate([-7.5, -LENS_H/2 + 5, 0]) cube([3, 11, 4.0]);
            translate([4.5, -LENS_H/2 + 5, 0]) cube([3, 11, 4.0]);
            
            // مفاصل الذراعين (Hinge lugs)
            translate([FRAME_W/2 - 6, LENS_H/2 - 9, 0]) cube([6, 9, 5.4]);
            translate([-FRAME_W/2, LENS_H/2 - 9, 0]) cube([6, 9, 5.4]);
        }
        
        // تجويف مستشعر الليزر (يُركب من الداخل/الخلف ليبقى الوجه الأمامي أملس وأنيق)
        translate([- SENS_W/2, - SENS_H/2, WALL])
            cube([SENS_W, SENS_H, SENS_D + 3]);
            
        // فتحتا ليزر دقيقتان فقط في واجهة الجسر الأمامية (كأنهما كاميرا ويب أنيقة)
        translate([- LENS_SEP/2, 0, -1]) cylinder(r = LENS_R, h = WALL + 2);
        translate([LENS_SEP/2, 0, -1]) cylinder(r = LENS_R, h = WALL + 2);
        
        // مجرى الأسلاك العلوي المخفي للذراع الأيمن
        translate([0, SENS_H/2 - 1, WALL + 0.4])
            cube([FRAME_W/2, 2.2, 2.0]);
            
        // ثقوب مسامير المفاصل (1.6 مم)
        translate([FRAME_W/2 - 3, LENS_H/2 - 4.5, -1]) cylinder(r = 0.9, h = 8);
        translate([-FRAME_W/2 + 3, LENS_H/2 - 4.5, -1]) cylinder(r = 0.9, h = 8);
    }
}

// --- [3] غطاء تثبيت المستشعر الخلفي لجسر الأنف (Nose Bridge Clip) ---
module bridge_lock_cover() {
    difference() {
        cube([SENS_W + 1.2, SENS_H + 1.2, 1.4]);
        // فتحة سلك التوصيل
        translate([(SENS_W + 1.2)/2 - 3, SENS_H - 2, -1])
            cube([6, 4, 4]);
    }
    // ألسنة تثبيت كابسة
    translate([0, 0, 1.4]) cube([1.2, SENS_H + 1.2, 1.2]);
    translate([SENS_W, 0, 1.4]) cube([1.2, SENS_H + 1.2, 1.2]);
}

// --- [4] الهيكل الخارجي الموحد للذراع (Symmetrical Arm Outer Body) ---
// كلا الذراعين لهما نفس هذا الهيكل تماماً من الخارج!
module unified_arm_shell() {
    hull() {
        // مفصلة الصدغ الأمامية
        cube([6, ARM_H_MAX, ARM_THICK]);
        // جسم الذراع الأوسط الحامل للمكونات
        translate([55, 0, 0])
            cube([10, ARM_H_MAX - 1.5, ARM_THICK]);
        // انحناء الأذن المريح
        translate([TEMPLE_L - 35, 2, 0])
            cube([12, ARM_H_MIN + 2, ARM_THICK - 1.5]);
        // نهاية الذراع الخلفية
        translate([TEMPLE_L - 4, 5, 0])
            cube([4, ARM_H_MIN, ARM_THICK - 2.5]);
    }
}

// --- [5] الذراع الأيمن (Right Temple) - يحوي الشريحة والبطارية ومنفذ USB-C ---
module right_temple_v2() {
    difference() {
        unified_arm_shell();
        
        // تجويف شريحة XIAO ESP32-C3
        translate([WALL + 4, WALL + 0.5, WALL])
            cube([MCU_W, MCU_H, MCU_D + 2]);
            
        // تجويف البطارية (خلف الشريحة مباشرة داخل نفس الذراع)
        translate([MCU_W + 8, WALL + 0.5, WALL])
            cube([BAT_L, BAT_W, BAT_D + 2]);
            
        // فتحة منفذ شحن USB-C (في الحافة السفلية للذراع)
        translate([WALL + 7, -1, WALL + 0.4])
            cube([9.6, WALL + 2, 3.8]);
            
        // مجرى مرور الأسلاك من المفصلة
        translate([-1, ARM_H_MAX/2 - 1.5, WALL + 1])
            cube([8, 3.0, 2.5]);
            
        // ثقب مسمار المفصلة الأمامية
        translate([3, ARM_H_MAX - 4, -1])
            cylinder(r = 0.9, h = ARM_THICK + 2);
            
        // حافة تعشيق الغطاء الكابس (Snap-fit Inner Ledge)
        translate([WALL + 2, WALL, ARM_THICK - 1.4])
            cube([MCU_W + BAT_L + 8, ARM_H_MAX - WALL*2 + 0.5, 2.0]);
    }
}

// --- [6] غطاء الذراع الأيمن الكابس (Right Arm Snap Cover) ---
module right_temple_cover_v2() {
    c_len = MCU_W + BAT_L + 7.5;
    c_w   = ARM_H_MAX - WALL*2;
    difference() {
        cube([c_len, c_w, 1.4]);
        // شطف انسيابي للحافة
        translate([c_len - 15, -1, -0.5])
            rotate([0, 0, -12]) cube([20, 5, 3]);
    }
    // ألسنة كبس محكمة (Snap tabs)
    translate([6, 0.2, 1.4]) cube([8, 0.8, 1.6]);
    translate([c_len - 14, 0.2, 1.4]) cube([8, 0.8, 1.6]);
    translate([6, c_w - 1.0, 1.4]) cube([8, 0.8, 1.6]);
    translate([c_len - 14, c_w - 1.0, 1.4]) cube([8, 0.8, 1.6]);
}

// --- [7] الذراع الأيسر (Left Temple) - متطابق خارجياً ويحوي الهزاز والمفتاح ---
module left_temple_v2() {
    difference() {
        unified_arm_shell();
        
        // تجويف محرك الاهتزاز الحسي (خلف الأذن مباشرة لنقل النبض للعظم)
        translate([TEMPLE_L - 32, 3.2, WALL])
            cylinder(r = HAPTIC_R, h = HAPTIC_D + 2);
            
        // تجويف مفتاح التشغيل متناهي الصغر (Micro Slide Switch ON/OFF)
        translate([WALL + 8, WALL + 1, WALL])
            cube([SW_L, SW_W, SW_H + 2]);
            
        // فتحة بروز زر المفتاح في أسفل الذراع للتحكم
        translate([WALL + 10, -1, WALL + 0.6])
            cube([4.5, WALL + 2, 2.8]);
            
        // تجويف داخلي لموازنة الوزن (يستوعب أسلاك أو بطارية إضافية)
        translate([SW_L + 16, WALL + 0.5, WALL])
            cube([BAT_L, BAT_W - 2, BAT_D + 1]);
            
        // مجرى السلك الداخلي
        translate([0, 4.5, WALL + 1])
            cube([TEMPLE_L - 30, 2.0, 2.0]);
            
        // ثقب مسمار المفصلة
        translate([3, ARM_H_MAX - 4, -1])
            cylinder(r = 0.9, h = ARM_THICK + 2);
            
        // حافة تعشيق الغطاء الكابس الأيسر
        translate([WALL + 2, WALL, ARM_THICK - 1.4])
            cube([MCU_W + BAT_L + 8, ARM_H_MAX - WALL*2 + 0.5, 2.0]);
    }
}

// --- [8] غطاء الذراع الأيسر الكابس (Left Arm Snap Cover) ---
module left_temple_cover_v2() {
    // مطابق تماماً لغطاء الذراع الأيمن لتحقيق التناظر الجمالي الكامل
    right_temple_cover_v2();
}

// ====================================================================
// 4. خريطة توزيع الأجزاء حسب وضع العرض (VIEW MODES)
// ====================================================================

if (VIEW_MODE == "ALL_FOR_PRINT") {
    // مصفوفة متكاملة ومرتبة بدقة متناهية داخل سرير طابعة Creality 220x220 مم
    // الأبعاد الإجمالية للمصفوفة: 142 مم عرض × 155 مم طول (تترك هوامش أمان واسعة)
    
    // 1. الإطار الأمامي في الأعلى مسطحاً على السرير
    color("DimGray") translate([0, 48, 0]) front_frame_v2();
    
    // 2. غطاء قفل المستشعر الصغير
    color("LightGray") translate([0, 14, 0]) bridge_lock_cover();
    
    // 3. الذراع الأيمن بالعرض (أفقي ومستقر)
    color("DimGray") translate([-TEMPLE_L/2, -12, 0]) right_temple_v2();
    
    // 4. الذراع الأيسر بالعرض (متطابق ومستقر)
    color("DimGray") translate([-TEMPLE_L/2, -36, 0]) left_temple_v2();
    
    // 5. غطاء الذراع الأيمن الكابس
    color("DodgerBlue") translate([-36, -60, 0]) right_temple_cover_v2();
    
    // 6. غطاء الذراع الأيسر الكابس
    color("DodgerBlue") translate([4, -60, 0]) left_temple_cover_v2();
}
else if (VIEW_MODE == "ASSEMBLED") {
    // عرض النظارة مجمعة ومغلقة بالأغطية (المظهر الحقيقي الفاخر)
    color("Black") front_frame_v2();
    color("Black") translate([FRAME_W/2 - 6, LENS_H/2 - 9, 0]) 
        rotate([0, 90, 0]) rotate([0, 0, -90]) right_temple_v2();
    color("Black") translate([-FRAME_W/2, LENS_H/2 - 9, 0]) 
        rotate([0, 90, 0]) rotate([0, 0, 90]) left_temple_v2();
}
else if (VIEW_MODE == "EXPLODED") {
    // المنظور التشريحي المفكك مع تباعد الأغطية
    color("Black") front_frame_v2();
    color("DeepSkyBlue") translate([0, 0, 15]) bridge_lock_cover();
    color("Black") translate([FRAME_W/2 + 25, LENS_H/2, 0]) rotate([0, 0, 12]) right_temple_v2();
    color("DeepSkyBlue") translate([FRAME_W/2 + 35, LENS_H/2, 18]) rotate([0, 0, 12]) right_temple_cover_v2();
    color("Black") translate([-FRAME_W/2 - 25, LENS_H/2, 0]) rotate([0, 0, -12]) left_temple_v2();
    color("DeepSkyBlue") translate([-FRAME_W/2 - 35, LENS_H/2, 18]) rotate([0, 0, -12]) left_temple_cover_v2();
}
else if (VIEW_MODE == "FRAME_ONLY") {
    front_frame_v2();
}
else if (VIEW_MODE == "TEMPLES_ONLY") {
    translate([0, 15, 0]) right_temple_v2();
    translate([0, -15, 0]) left_temple_v2();
}
else if (VIEW_MODE == "COVERS_ONLY") {
    translate([-30, 0, 0]) right_temple_cover_v2();
    translate([30, 0, 0]) left_temple_cover_v2();
    translate([0, 25, 0]) bridge_lock_cover();
}
