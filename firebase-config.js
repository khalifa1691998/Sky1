// firebase-config.js
// --- إعدادات Firebase + نظام تسجيل دخول حقيقي عبر Firebase Authentication ---
// تم إلغاء تسجيل الدخول المجهول (Anonymous Auth) نهائياً. كل دخول للنظام
// الآن لازم يمر عبر حساب حقيقي في Firebase Authentication (Email/Password).

// إعدادات مشروع Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBJFklOjaZrJ3oTYOaUpvG_TdT7oJMgG2k",
  authDomain: "sky-erp-a2e55.firebaseapp.com",
  projectId: "sky-erp-a2e55",
  storageBucket: "ky-erp-a2e55.firebasestorage.app",
  messagingSenderId: "4030815598",
  appId: "1:4030815598:web:77b78076e02bbe7802f57f"
};

// نطاق داخلي وهمي لتحويل "اسم المستخدم" الذي يكتبه المستخدم في شاشة الدخول
// إلى صيغة إيميل تقبلها خدمة Firebase Authentication. المستخدم لا يرى ولا
// يستخدم هذا الإيميل إطلاقاً؛ هو فقط تنسيق داخلي للمصادقة.
const AUTH_EMAIL_DOMAIN = '@sky-erp-auth.app';

function usernameToAuthEmail(username) {
  const clean = (username || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  return `${clean}${AUTH_EMAIL_DOMAIN}`;
}

(function() {
  try {
    if (typeof firebase === 'undefined' || !firebaseConfig.apiKey) {
      console.warn("Firebase scripts not loaded or config missing. Running in Local Mode.");
      window.firebaseApp = undefined;
      window.firebaseDB = undefined;
      window.firebaseAuth = undefined;
      window.FirebaseAuthService = undefined;
      return;
    }

    const _fbApp = firebase.initializeApp(firebaseConfig);
    const _fbDB = firebase.firestore();
    const _fbAuth = firebase.auth();
    // FIX: كانت خدمة Storage غير مُهيّأة خالص (المكتبة نفسها ماكنتش
    // محمّلة أصلاً) رغم إن باقي الكود بيفترض وجودها لرفع صور العملاء.
    const _fbStorage = (typeof firebase.storage === 'function') ? firebase.storage() : undefined;

    // نجبر Firebase على تخزين جلسة الدخول بشكل دائم (LOCAL) بدل ما نسيبها على
    // الإعداد الافتراضي. ده مهم جداً خصوصاً لو الموقع بيتفتح كملف محلي (file://)
    // أو من مصادر مش مستقرة، عشان الجلسة متضيعش لوحدها عند عمل Refresh للصفحة.
    _fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(err) {
      console.warn("تعذر ضبط نوع تخزين جلسة الدخول (persistence):", err);
    });

    // جعل كائنات Firebase متاحة عالمياً عبر window
    window.firebaseApp = firebase;
    window.firebaseDB = _fbDB;
    window.firebaseAuth = _fbAuth;
    window.firebaseStorage = _fbStorage;

    console.log("Firebase initialized successfully. Waiting for real authentication...");

    // مراقبة حالة تسجيل الدخول الحقيقية. لا يوجد أي دخول تلقائي مجهول بعد الآن؛
    // فقط عند نجاح signInWithEmailAndPassword أو استعادة جلسة محفوظة سابقاً
    // من نفس المتصفح سيتم إطلاق هذا الحدث بـ signedIn = true.
    _fbAuth.onAuthStateChanged(function(user) {
      if (user) {
        console.log("Firebase Auth: تم تأكيد الدخول لحساب:", user.email);
        window.dispatchEvent(new CustomEvent('firebase-auth-changed', {
          detail: { signedIn: true, uid: user.uid, email: user.email }
        }));
      } else {
        console.log("Firebase Auth: لا يوجد جلسة دخول نشطة.");
        window.dispatchEvent(new CustomEvent('firebase-auth-changed', {
          detail: { signedIn: false }
        }));
      }
    });

    // ================= خدمات المصادقة المتاحة لباقي النظام (app.js) =================
    window.FirebaseAuthService = {
      usernameToAuthEmail,

      // تسجيل الدخول باستخدام اسم مستخدم + كلمة مرور حقيقيين عبر Firebase Auth
      signIn: function(username, password) {
        const email = usernameToAuthEmail(username);
        return _fbAuth.signInWithEmailAndPassword(email, password);
      },

      // تسجيل الخروج
      signOut: function() {
        return _fbAuth.signOut();
      },

      // إنشاء حساب Firebase Authentication جديد لمستخدم آخر (مثلاً: الأدمن
      // بيضيف محصّل جديد) دون التأثير على جلسة الدخول الحالية للأدمن.
      // الحيلة: نفتح تطبيق Firebase ثانوي مؤقت، ننشئ فيه الحساب، ثم نحذفه فوراً.
      createAuthUser: async function(username, password) {
        const email = usernameToAuthEmail(username);
        const secondary = firebase.initializeApp(firebaseConfig, 'Secondary_' + Date.now());
        try {
          const cred = await secondary.auth().createUserWithEmailAndPassword(email, password);
          const uid = cred.user.uid;
          await secondary.auth().signOut();
          return { success: true, uid };
        } finally {
          await secondary.delete();
        }
      },

      // ============================================================
      // FIX: إنشاء/تحديث مستند userRoles في Firestore لمستخدم معين.
      // هذه الدالة ضرورية لأن قواعد الأمان (Rules) تعتمد على مجموعة userRoles
      // للتحقق من صلاحية أي مستخدم قبل السماح له بأي عملية كتابة.
      // إذا لم يكن هذا المستند موجوداً، سيتم رفض كل عمليات الكتابة حتى للأدمن.
      // ============================================================
      ensureUserRoleDoc: async function(uid, role, name) {
        if (!uid || !role) return;
        try {
          const roleRef = _fbDB.collection('userRoles').doc(uid);
          const payload = { role: role };
          // FIX: بنخزن اسم المستخدم الحقيقي هنا كمان (لو اتبعت)، عشان قواعد
          // الأمان تقدر تتحقق إن أي حد بيكتب Log في auditLogs بيكتب باسمه
          // الحقيقي بس، مش أي اسم تاني يختاره من جهازه (منع تزوير السجل).
          if (name) payload.name = name;
          await roleRef.set(payload, { merge: true });
          console.log(`✅ تم إنشاء/تحديث مستند userRoles للـ UID: ${uid} بالدور: ${role}`);
        } catch (err) {
          console.error(`❌ فشل إنشاء مستند userRoles للـ UID: ${uid}`, err);
          throw err;
        }
      }
    };

  } catch (error) {
    console.error("Firebase initialization error:", error);
    window.firebaseApp = undefined;
    window.firebaseDB = undefined;
    window.firebaseAuth = undefined;
    window.FirebaseAuthService = undefined;
  }
})();
