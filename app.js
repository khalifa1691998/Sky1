/**
 * نظام شركة SKY - المحرك البرمجي الرئيسي لإدارة الحسابات والأقساط والخزينة
 * المطور: Khalifa (ADMIN)
 */

console.log('SKY_BUILD_VERSION: v3-balances-standalone-tab-2026-07-05');
// ================= STATE MANAGEMENT & INITIAL DATABASE =================
// متغير عالمي لحالة الاتصال بـ Firebase
let firebaseSubscriptionActive = false;
// دالة إلغاء الاشتراك في التحديثات الفورية (onSnapshot) الراجعة من
// FirebaseService.subscribeToUpdates. كانت قبل كده بتترمي وما تتخزنش، فكل
// دخول جديد بعد خروج كان بيضيف 18 listener فوق اللي قبله من غير ما يقفلهم
// أبداً (Memory/Listener Leak). دلوقتي بنخزنها هنا عشان نقدر نقفلها صح.
let firebaseUnsubscribeUpdates = null;

let db = {

  clients: [],
  clientFollowUps: [], // سجل ملاحظات/متابعة العميل: { id, clientId, clientName, note, nextFollowUpDate, createdBy, timestamp }
  customerRequests: [], // طلبات عملاء لمنتجات مش متوفرة: { id, clientId, clientName, clientPhone, productDescription, status, notes, createdBy, timestamp }
  recurringExpenses: [], // مصروفات شهرية ثابتة: { id, category, amount, active, lastAppliedMonth (YYYY-MM), createdBy, timestamp }
  pendingWithdrawals: [], // طلبات سحب كبيرة محتاجة موافقة أدمن تاني: { id, type, investorId, investorName, amount, notes, requestedBy, requestedByUserId, status, timestamp }
  cashReconciliations: [], // تسوية الخزينة اليومية: { id, date, expectedAmount, actualAmount, difference, notes, performedBy, timestamp }
  blacklist: [], // قائمة سوداء لغير العملاء: { id, name, nationalId, phone, reason, addedBy, timestamp }
  inventory: [],
  brands: [], // ماركات تابعة لصنف معين: { id, name, categoryId } - تُستخدم في تبويب "الأصناف والمنتجات" وتبويب "المخزون" معاً (نظام موحد: صنف ← ماركة ← منتج/موديل)
  suppliers: [],
  supplierTransactions: [], // سجل حركات الموردين: مشتريات آجل/كاش وسدادات { id, supplierId, supplierName, type, method, amount, timestamp, notes }
  productCategories: [], // أصناف المنتجات (هواتف، أجهزة كهربائية، إكسسوارات...): { id, name, notes }
  products: [], // المنتجات/الموديلات النهائية تحت كل صنف وماركة: { id, categoryId, brand, name, unit, minQty, costPrice, sellingPrice, defaultSupplierId, notes }
  productStockMovements: [], // حركات وارد/صادر لكل منتج: { id, productId, productName, type: 'in'|'out', reason, quantity, unitCost, totalCost, supplierId, supplierName, timestamp, notes }
  contracts: [],
  installments: [],
  collectorCustodies: [],
  treasuryTransactions: [],
  users: [],
  auditLogs: [],
  investors: [], // المستثمرون ورأس مال الشركة: { id, name, capitalAmount, joinDate, notes, totalWithdrawn, fixedSharePercent }
  investorSnapshots: [], // تجميدات دورية لصافي الربح: { id, timestamp, totalAssets, totalCapital, totalWithdrawn, netProfit, perInvestor: [...] }
  expenses: [], // سجل المصروفات التشغيلية: { id, category, amount, date, description, paidBy, timestamp }
  settings: {
    offlineMode: false,
    companyName: 'شركة SKY',
    companyLogo: '', // Base64 or URL
    // IMPROVEMENT #6: تسجيل خروج تلقائي بعد 20 دقيقة خمول بشكل افتراضي؛ الأدمن
    // يقدر يغيّرها أو يعطّلها (0) من الإعدادات.
    sessionTimeoutMinutes: 20,
    staffPermissions: {
      'clients': true,
      'client-balances': true,
      'inventory': true,
      'suppliers': true,
      'products': true,
      'contracts': true,
      'collections': true,
      'treasury': false,
      'investors': false,
      'expenses': false,
      'today-reminders': true,
      'reports': true
    },
    // IMPROVEMENT #3: صلاحيات دور COLLECTOR الافتراضية - نفس السلوك القديم
    // بالظبط (كل حاجة false، يعني المحصّل يشوف تبويب "التحصيلات" بس) لحد ما
    // الأدمن يمنح صلاحيات إضافية بنفسه من الإعدادات.
    collectorPermissions: {
      'collection-followups': false,
      'clients': false,
      'client-balances': false,
      'today-reminders': false
    },
    templates: {
      reminder: `مرحباً أ/ {{الاسم}}،
نود تذكيركم بموعد استحقاق القسط الشهري لعقدكم رقم {{العقد}} لدى {{اسم_الشركة}}.
المبلغ المطلوب: {{القسط}} ج.م.
تاريخ الاستحقاق: {{التاريخ}}.
يرجى التنسيق مع المحصل لتسوية المبلغ في الموعد المحدد. شكراً لتعاونكم المتواصل 🌹`,
      warning: `تنبيه هام وعاجل ⚠️
السيد/ {{الاسم}}،
نحيطكم علماً بتجاوز تاريخ استحقاق قسطكم لعقد رقم {{العقد}} والمستحق بتاريخ {{التاريخ}}، وقد انقضت فترة السماح.
تفاصيل المتأخرات:
- قيمة القسط الأصلية: {{القسط}} ج.م
- غرامة التأخير المتراكمة: {{الغرامة}} ج.م
إجمالي المبلغ المطلوب سداده فوراً: {{المطلوب}} ج.م.
نرجو السداد الفوري لتفادي اتخاذ الإجراءات القانونية.`,
      receipt: `تم استلام دفعتكم بنجاح 🧾
أ/ {{الاسم}}،
نشكركم على سداد القسط الشهري لعقدكم رقم {{العقد}} لدى {{اسم_الشركة}}.
المبلغ المحصل: {{القسط}} ج.م.
رقم إيصال التحصيل: {{الإيصال}}.
تم تسجيل المبلغ بخزيناتنا المالية وتحديث حسابكم. دمتم بكل خير ✨`
    }
  }
};

// ================= GRANULAR PERMISSIONS (دور STAFF) =================
// التبويبات دي هي الوحيدة القابلة للتحكم فيها من شاشة الإعدادات لدور "موظف
// إدخال بيانات" (STAFF). تبويبات users / settings / audit-log مقفولة دايماً
// على المشرف (Admin) فقط ومش قابلة للمنح لأي دور تاني لأسباب أمنية.
const STAFF_PERMISSION_TABS = ['clients', 'customer-requests', 'client-balances', 'inventory', 'suppliers', 'products', 'contracts', 'collections', 'collection-followups', 'treasury', 'investors', 'expenses', 'today-reminders', 'reports'];
const ADMIN_ONLY_TABS = ['users', 'settings', 'audit-log'];

// IMPROVEMENT #3: مجموعة تبويبات إضافية ممكن تُمنح لدور المحصّل (COLLECTOR)
// بشكل اختياري من الإعدادات، غير تبويب "التحصيلات" اللي متاح له دايماً بشكل
// ثابت. اخترنا هنا تبويبات مناسبة لطبيعة شغل المحصّل الميداني وبياناتها كلها
// مقروءة أصلاً لأي مستخدم موقّع في قواعد Firestore (عملاء/عقود/أقساط). عمداً
// استبعدنا تبويب "التقارير" رغم إنه كان مرشّح، لأنه بيعرض أرقام من مجموعتي
// treasuryTransactions وexpenses المحميتين بصلاحية STAFF/ADMIN فقط في قواعد
// الأمان - منحه هنا كان هيدّي شاشة تقارير مالية مكسورة (بيانات ناقصة) للمحصّل
// بدل ما يفيده، فمستبعد لحد ما تتضاف صلاحية مخصصة له في قواعد Firestore.
const COLLECTOR_PERMISSION_TABS = ['collection-followups', 'clients', 'client-balances', 'today-reminders'];

function getDefaultStaffPermissions() {
  const perms = {};
  STAFF_PERMISSION_TABS.forEach(t => perms[t] = true);
  return perms;
}

// كل التبويبات الإضافية تبدأ false افتراضياً (يعني نفس السلوك القديم بالظبط:
// المحصّل يشوف "التحصيلات" بس لحد ما الأدمن يمنحه صلاحيات إضافية بنفسه).
function getDefaultCollectorPermissions() {
  const perms = {};
  COLLECTOR_PERMISSION_TABS.forEach(t => perms[t] = false);
  return perms;
}

// نقطة مركزية واحدة لتحديد هل المستخدم الحالي مسموح له يشوف تبويب معين ولا لأ،
// بتستخدمها كل من إخفاء/إظهار الروابط في القائمة الجانبية ومنع التنقل المباشر
// لأي تبويب غير مصرح به (حتى لو حاول حد يستدعي switchTab برمجياً أو من history).
function isTabAllowedForCurrentUser(tabName) {
  if (!currentUser) return false;
  if (currentUser.role === 'ADMIN') return true;
  if (currentUser.role === 'COLLECTOR') {
    // FEATURE (تحسين ٣): تبويب "التحصيلات" ثابت ومتاح دايماً للمحصّل، وأي
    // تبويب تاني بيتحدد حسب صلاحيات collectorPermissions اللي الأدمن حدّدها
    // من الإعدادات (بدل ما يكون مقفول برمجياً على "التحصيلات" بس زي الأول).
    if (tabName === 'collections') return true;
    if (!COLLECTOR_PERMISSION_TABS.includes(tabName)) return false;
    const perms = (db.settings && db.settings.collectorPermissions) ? db.settings.collectorPermissions : getDefaultCollectorPermissions();
    return perms[tabName] === true;
  }
  if (currentUser.role === 'STAFF') {
    if (tabName === 'dashboard') return true;
    if (ADMIN_ONLY_TABS.includes(tabName)) return false;
    const perms = (db.settings && db.settings.staffPermissions) ? db.settings.staffPermissions : getDefaultStaffPermissions();
    return perms[tabName] !== false;
  }
  return false;
}

// Temp file upload storage (base64)
let tempUploads = {
  clientCardImg: '',
  clientContractImg: '',
  guarantorCardImg: '',
  guarantorContractImg: ''
};

// Keep track of expanded client IDs in Collections Tab
let expandedClients = new Set();

// Default Seed Data
// ملاحظة: تم حذف كل بيانات المستخدمين/العملاء/العقود التجريبية (وكلمات المرور
// النصية المصاحبة لها) اللي كانت هنا سابقاً. زرار "إعادة حقن البيانات
// الافتراضية" في الإعدادات دلوقتي بيرجع النظام لحالة فاضية تماماً بدل ما
// يحقن حسابات وهمية بكلمة مرور "123" كانت ظاهرة لأي حد يفتح مصدر الصفحة.
const defaultSeedData = {
  users: [],
  brands: [], // نظام الماركات الجديد: كل ماركة لازم تكون مرتبطة بصنف (categoryId)، فمفيش ماركات افتراضية جاهزة قبل ما تنشئ صنف الأول
  suppliers: [],
  supplierTransactions: [],
  productCategories: [],
  products: [],
  productStockMovements: [],
  clients: [],
  clientFollowUps: [],
  customerRequests: [],
  recurringExpenses: [],
  pendingWithdrawals: [],
  cashReconciliations: [],
  blacklist: [],
  inventory: [],
  contracts: [],
  installments: [],
  collectorCustodies: [],
  treasuryTransactions: [],
  auditLogs: [],
  investors: [],
  investorSnapshots: [],
  expenses: [],
  settings: {
    offlineMode: false,
    companyName: 'شركة SKY',
    companyLogo: '',
    // IMPROVEMENT #6: تسجيل خروج تلقائي بعد 20 دقيقة خمول بشكل افتراضي؛ الأدمن
    // يقدر يغيّرها أو يعطّلها (0) من الإعدادات.
    sessionTimeoutMinutes: 20,
    staffPermissions: {
      'clients': true,
      'client-balances': true,
      'inventory': true,
      'suppliers': true,
      'products': true,
      'contracts': true,
      'collections': true,
      'treasury': false,
      'investors': false,
      'expenses': false,
      'today-reminders': true,
      'reports': true
    },
    // IMPROVEMENT #3: صلاحيات دور COLLECTOR الافتراضية - نفس السلوك القديم
    // بالظبط (كل حاجة false، يعني المحصّل يشوف تبويب "التحصيلات" بس) لحد ما
    // الأدمن يمنح صلاحيات إضافية بنفسه من الإعدادات.
    collectorPermissions: {
      'collection-followups': false,
      'clients': false,
      'client-balances': false,
      'today-reminders': false
    },
    templates: {
      reminder: `مرحباً أ/ {{الاسم}}،
نود تذكيركم بموعد استحقاق القسط الشهري لعقدكم رقم {{العقد}} لدى {{اسم_الشركة}}.
المبلغ المطلوب: {{القسط}} ج.م.
تاريخ الاستحقاق: {{التاريخ}}.
يرجى التنسيق مع المحصل لتسوية المبلغ في الموعد المحدد. شكراً لتعاونكم المتواصل 🌹`,
      warning: `تنبيه هام وعاجل ⚠️
السيد/ {{الاسم}}،
نحيطكم علماً بتجاوز تاريخ استحقاق قسطكم لعقد رقم {{العقد}} والمستحق بتاريخ {{التاريخ}}، وقد انقضت فترة السماح.
تفاصيل المتأخرات:
- قيمة القسط الأصلية: {{القسط}} ج.م
- غرامة التأخير المتراكمة: {{الغرامة}} ج.م
إجمالي المبلغ المطلوب سداده فوراً: {{المطلوب}} ج.م.
نرجو السداد الفوري لتفادي اتخاذ الإجراءات القانونية.`,
      receipt: `تم استلام دفعتكم بنجاح 🧾
أ/ {{الاسم}}،
نشكركم على سداد القسط الشهري لعقدكم رقم {{العقد}} لدى {{اسم_الشركة}}.
المبلغ المحصل: {{القسط}} ج.م.
رقم إيصال التحصيل: {{الإيصال}}.
تم تسجيل المبلغ بخزيناتنا المالية وتحديث حسابكم. دمتم بكل خير ✨`
    }
  }
};

// Function to generate due installments for seeded contracts on startup
function generateSeededInstallments() {
  db.installments = [];
  db.contracts.forEach(contract => {
    let start = new Date(contract.startDate);
    for (let i = 1; i <= contract.duration; i++) {
      let dueDate = new Date(start);
      dueDate.setMonth(start.getMonth() + (i - 1));
      
      db.installments.push({
        id: `${contract.id}_${i}`,
        contractId: contract.id,
        clientId: contract.clientId,
        clientName: contract.clientName,
        clientPhone: contract.clientPhone,
        guarantorName: db.clients.find(c => c.id === contract.clientId)?.guarantorName || '',
        guarantorPhone: db.clients.find(c => c.id === contract.clientId)?.guarantorPhone || '',
        collectorName: contract.collectorName,
        installmentNum: i,
        amount: contract.monthlyInstallment,
        dueDate: dueDate.toISOString().split('T')[0],
        status: 'pending',
        paidAmount: 0,
        paidDate: '',
        receiptId: '',
        delayFines: 0
      });
    }
  });
}

// ================= CUSTOM CONFIRM MODAL =================
// بديل لصندوق confirm() الافتراضي بالمتصفح (اللي بيظهر بشكل نافذة منفصلة
// وبيكتب اسم الدومين "khalifa1691998.github.io says" - بيحسس المستخدم إنه
// جزء من المتصفح مش من الموقع). المودال ده مصمم بنفس هوية الموقع بالكامل.
// FIX: بتقبل دلوقتي تسميات مخصصة لزرار التأكيد/الإلغاء (okLabel, cancelLabel)
// اختيارية - لو مافيش، بترجع للتسميات الافتراضية "تأكيد"/"إلغاء" زي ما كانت
// دايماً، فمفيش أي تأثير على الاستخدامات التانية للدالة دي في باقي النظام.
// السبب: أسئلة يس/نو حقيقية (زي "هل استلمت فلوس نقداً؟") بأزرار عامة زي
// "تأكيد" كانت بتتفهم غلط كـ"وافق على إكمال العملية" مش "أيوه استلمت فلوس"،
// وده سبب فعلياً تسجيل استرداد نقدي وهمي في مرتجعات الموردين (بند ٤.١ من
// تقرير المراجعة).
function customConfirm(message, title, okLabel, cancelLabel) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-confirm-modal');
    const msgEl = document.getElementById('custom-confirm-message');
    const titleEl = document.getElementById('custom-confirm-title');
    const okBtn = document.getElementById('custom-confirm-ok-btn');
    const cancelBtn = document.getElementById('custom-confirm-cancel-btn');

    if (!modal || !msgEl || !okBtn || !cancelBtn) {
      showSystemAlert(message, 'تعذر فتح نافذة التأكيد');
      resolve(false);
      return;
    }

    msgEl.textContent = message;
    titleEl.textContent = title || 'تأكيد العملية';
    okBtn.textContent = okLabel || 'تأكيد';
    cancelBtn.textContent = cancelLabel || 'إلغاء';
    modal.classList.remove('hidden');

    function cleanup(result) {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeydown, true);
      // نرجع تسميات الأزرار للوضع الافتراضي عشان أي استخدام تاني عادي
      // للدالة بعد كده ميفضلش وارث تسميات مخصصة من نداء سابق.
      okBtn.textContent = 'تأكيد';
      cancelBtn.textContent = 'إلغاء';
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(false);
      }
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown, true);
  });
}
window.customConfirm = customConfirm;

// ================= SYSTEM DIALOGS =================
// بديل موحّد لأي alert / prompt من المتصفح، حتى تبقى كل الرسائل داخل هوية النظام.
// IMPROVEMENT #5: نافذة تظهر فور اعتماد عقد جديد بنجاح، بتعرض بيانات سريعة
// عن العقد وتدّي المستخدم اختيار مباشر لطباعة/تحميل العقد الرسمي (اللي فيه
// أصلاً جدول أقساط كامل بكل مواعيد الاستحقاق) بدل ما يضطر يدوّر عليه لاحقاً.
function showContractCreatedDialog(contractId) {
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;
  const client = db.clients.find(c => c.id === contract.clientId);

  document.getElementById('contract-created-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'contract-created-dialog';
  overlay.className = 'system-dialog fixed inset-0 z-[10000] flex items-center justify-center p-4';
  const card = document.createElement('section');
  card.className = 'system-dialog-card w-full max-w-md rounded-2xl p-5 sm:p-6';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');

  const iconEl = document.createElement('div');
  iconEl.className = 'system-dialog-icon';
  iconEl.style.color = '#059669';
  iconEl.innerHTML = `<i class="ph ph-check-circle text-2xl"></i>`;
  const titleEl = document.createElement('h3');
  titleEl.className = 'system-dialog-title';
  titleEl.textContent = 'تم اعتماد العقد بنجاح';
  const messageEl = document.createElement('p');
  messageEl.className = 'system-dialog-message';
  messageEl.textContent = `عقد رقم ${contractId.replace('con-', '')} للعميل ${client ? client.name : ''} بقيمة ${contract.totalValue.toLocaleString()} ج.م على ${contract.duration} قسط. تقدر تطبع العقد الرسمي وجدول مواعيد السداد الآن أو لاحقاً من تبويب العقود.`;

  const btnRow = document.createElement('div');
  btnRow.className = 'flex flex-col sm:flex-row gap-2 mt-2';

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'system-dialog-button flex-1';
  printBtn.style.background = '#4f46e5';
  printBtn.innerHTML = `<i class="ph ph-printer mr-1"></i> طباعة العقد وجدول الأقساط`;
  printBtn.addEventListener('click', () => {
    overlay.remove();
    window.printFormalContract(contractId);
  });

  const laterBtn = document.createElement('button');
  laterBtn.type = 'button';
  laterBtn.className = 'system-dialog-button flex-1';
  laterBtn.style.background = '#64748b';
  laterBtn.textContent = 'لاحقاً';
  laterBtn.addEventListener('click', () => overlay.remove());

  btnRow.append(printBtn, laterBtn);
  card.append(iconEl, titleEl, messageEl, btnRow);
  overlay.appendChild(card);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => printBtn.focus());
}

function showSystemAlert(message, title) {
  document.getElementById('system-alert-dialog')?.remove();
  const text = String(message || '');
  const isError = /❌|⛔|فشل|خطأ|تعذر/.test(text);
  const isWarning = !isError && /⚠️|تحذير|يرجى|لا توجد/.test(text);
  const accent = isError ? '#f43f5e' : isWarning ? '#f59e0b' : '#8b7cf6';
  const icon = isError ? 'ph-x-circle' : isWarning ? 'ph-warning-circle' : 'ph-info';

  const overlay = document.createElement('div');
  overlay.id = 'system-alert-dialog';
  overlay.className = 'system-dialog fixed inset-0 z-[10000] flex items-center justify-center p-4';
  const card = document.createElement('section');
  card.className = 'system-dialog-card w-full max-w-md rounded-2xl p-5 sm:p-6';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  const iconEl = document.createElement('div');
  iconEl.className = 'system-dialog-icon';
  iconEl.style.color = accent;
  iconEl.innerHTML = `<i class="ph ${icon} text-2xl"></i>`;
  const titleEl = document.createElement('h3');
  titleEl.className = 'system-dialog-title';
  titleEl.textContent = title || (isError ? 'تعذر إتمام العملية' : isWarning ? 'تنبيه' : 'رسالة من النظام');
  const messageEl = document.createElement('p');
  messageEl.className = 'system-dialog-message';
  messageEl.textContent = text;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'system-dialog-button';
  button.textContent = 'حسناً';
  button.style.background = accent;
  const close = () => {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      close();
    }
  };
  button.addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  card.append(iconEl, titleEl, messageEl, button);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKeydown, true);
  requestAnimationFrame(() => button.focus());
}

function customPrompt(message, defaultValue = '', title = 'أدخل البيانات المطلوبة') {
  return new Promise((resolve) => {
    document.getElementById('system-prompt-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'system-prompt-dialog';
    overlay.className = 'system-dialog fixed inset-0 z-[10000] flex items-center justify-center p-4';
    const card = document.createElement('section');
    card.className = 'system-dialog-card w-full max-w-md rounded-2xl p-5 sm:p-6';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    const heading = document.createElement('h3');
    heading.className = 'system-dialog-title';
    heading.textContent = title;
    const description = document.createElement('p');
    description.className = 'system-dialog-message';
    description.textContent = message;
    const input = document.createElement('input');
    input.className = 'form-input system-dialog-input';
    input.value = defaultValue;
    const actions = document.createElement('div');
    actions.className = 'system-dialog-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'system-dialog-cancel';
    cancel.textContent = 'إلغاء';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'system-dialog-button';
    confirm.textContent = 'تأكيد';
    const cleanup = (value) => {
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); cleanup(null); }
      if (event.key === 'Enter') { event.preventDefault(); cleanup(input.value); }
    };
    cancel.addEventListener('click', () => cleanup(null));
    confirm.addEventListener('click', () => cleanup(input.value));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(null); });
    actions.append(cancel, confirm);
    card.append(heading, description, input, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeydown, true);
    requestAnimationFrame(() => input.focus());
  });
}

window.showSystemAlert = showSystemAlert;
window.customPrompt = customPrompt;
window.alert = (message) => showSystemAlert(message);

// ================= أمان العرض: تعقيم أي نص قبل حقنه في innerHTML =================
// أي بيانات كتبها مستخدم (اسم عميل، ملاحظة، اسم مورد، اسم محصل...) لازم تمر
// من هنا قبل ما تتحط جوه أي innerHTML أو attribute، عشان نمنع حقن HTML/JS
// (Stored XSS) لو حد كتب مثلاً اسم عميل فيه <script> أو علامة اقتباس.
function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escapeHTML = escapeHTML;

// دالة صغيرة موحّدة لعرض اسم المورد + نوع التعامل معه (كاش/آجل) في أي قائمة
// <select> بالنظام، بدل ما نفس الجملة كانت مكررة حرفياً في أكتر من مكان.
function formatSupplierOptionLabel(s) {
  const typeLabel = s.type === 'cash' ? ' (كاش)' : s.type === 'both' ? ' (كاش/آجل)' : ' (آجل)';
  return `${s.name}${typeLabel}`;
}
window.formatSupplierOptionLabel = formatSupplierOptionLabel;

// ================= SESSION / LOGIN MANAGEMENT (Firebase Authentication) =================
// تسجيل الدخول أصبح يعتمد بالكامل على Firebase Authentication الحقيقي بدل
// المقارنة اليدوية لكلمة المرور. لا توجد كلمات مرور نصية تُقرأ من قاعدة البيانات بعد الآن.
let currentUser = null;

// FIX: حماية من الضغط المزدوج بالغلط على أزرار العمليات المهمة (سداد مبكر،
// استرجاع، ترقية، موافقة سحب...) - نفس فكرة تعطيل زرار الفورم، بس هنا
// بنستخدم "قفل" بمفتاح مميز لكل عملية عشان الزرار مش جوه form وممكن نفس
// الدالة تتنفذ لعناصر مختلفة (contractId مختلف) في نفس الوقت من غير ما
// نمنعها من بعض.
const _activeActionLocks = new Set();
async function runWithActionLock(lockKey, fn) {
  if (_activeActionLocks.has(lockKey)) return;
  _activeActionLocks.add(lockKey);
  try {
    await fn();
  } finally {
    _activeActionLocks.delete(lockKey);
  }
}

function isAdmin() {
  return currentUser && currentUser.role === 'ADMIN';
}

function getCurrentUserName() {
  return currentUser ? currentUser.name : 'مجهول';
}

function hideSessionCheckOverlay() {
  const overlay = document.getElementById('session-check-overlay');
  if (overlay) overlay.classList.add('hidden');
  if (typeof handleMobileTopbar === 'function') handleMobileTopbar();
}

function showLoginScreen() {
  hideSessionCheckOverlay();
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('app-wrapper').classList.add('hidden');
  document.getElementById('login-username-input').value = '';
  document.getElementById('login-password-input').value = '';
  setLoginLoading(false);
  if (typeof handleMobileTopbar === 'function') handleMobileTopbar();
}

function hideLoginScreen() {
  hideSessionCheckOverlay();
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('app-wrapper').classList.remove('hidden');
  if (typeof handleMobileTopbar === 'function') handleMobileTopbar();
}

function showLoginError(message) {
  const errorMsg = document.getElementById('login-error-msg');
  errorMsg.textContent = message;
  errorMsg.classList.remove('hidden');
}

function hideLoginError() {
  document.getElementById('login-error-msg').classList.add('hidden');
}

// تبديل شكل زرار الدخول بين الحالة العادية وحالة "جاري التحقق"
function setLoginLoading(isLoading, message) {
  const btn = document.getElementById('login-submit-btn');
  if (!btn) return;
  btn.disabled = isLoading;
  btn.innerHTML = isLoading
    ? `<i class="ph ph-spinner ph-spin"></i><span>${message || 'جاري التحقق...'}</span>`
    : `<i class="ph ph-sign-in"></i><span>تسجيل الدخول</span>`;
}

// يُستدعى عند الضغط على زرار "تسجيل الدخول" - يرسل الطلب فعلياً لـ Firebase Authentication
async function performLogin() {
  const username = document.getElementById('login-username-input').value.trim();
  const password = document.getElementById('login-password-input').value.trim();
  hideLoginError();

  if (!username || !password) {
    showLoginError('❌ من فضلك ادخل اسم المستخدم وكلمة المرور.');
    return;
  }

  if (!window.FirebaseAuthService) {
    showLoginError('❌ تعذر الاتصال بخدمة تسجيل الدخول (Firebase). تأكد من اتصال الإنترنت وحاول تحديث الصفحة.');
    return;
  }

  setLoginLoading(true);
  try {
    // النجاح هنا لا يعني اكتمال الدخول؛ باقي إجراءات الدخول (تحميل البروفايل
    // وفتح الشاشة الرئيسية) تتم تلقائياً عبر مستمع حدث firebase-auth-changed
    await window.FirebaseAuthService.signIn(username, password);
  } catch (error) {
    console.error('Login error:', error.code, error.message);
    let msg = '❌ اسم المستخدم أو كلمة المرور غير صحيحة.';
    if (error.code === 'auth/too-many-requests') {
      msg = '⏳ محاولات دخول خاطئة كثيرة. من فضلك انتظر قليلاً وحاول مرة أخرى.';
    } else if (error.code === 'auth/network-request-failed') {
      msg = '❌ لا يوجد اتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى.';
    } else if (error.code === 'auth/user-disabled') {
      msg = '⛔ هذا الحساب معطّل. تواصل مع مشرف النظام.';
    }
    showLoginError(msg);
    document.getElementById('login-password-input').value = '';
    setLoginLoading(false);
  }
}

// بعد نجاح الدخول في Firebase Authentication، نبحث عن بروفايل هذا المستخدم
// (الاسم، الدور، المنطقة...) داخل مجموعة "users" في Firestore بمطابقة authUid
async function resolveCurrentUserFromAuth(uid, email) {
  let user = db.users.find(u => u.authUid === uid);

  // --- شبكة أمان: لو المستخدم متسجل بحساب Firebase Auth حقيقي وناجح، لكن
  // ملفه في Firestore لسه معندوش authUid (لسه ما اتعمل له ترحيل، أو الترحيل
  // فشل جزئياً)، بنحاول نطابقه عن طريق الإيميل الداخلي (username -> email)
  // بدل ما نعمل تسجيل خروج فوري ونرجّعه لشاشة الدخول من غير أي سبب واضح له.
  // ده هو سبب مشكلة "الرجوع لصفحة الدخول عند أي Refresh".
  if (!user && email && window.FirebaseAuthService) {
    user = db.users.find(u => window.FirebaseAuthService.usernameToAuthEmail(u.username) === email);
    if (user) {
      console.warn(`تم إيجاد المستخدم "${user.username}" عن طريق الإيميل بدل authUid. جاري إصلاح ملفه تلقائياً...`);
      user.authUid = uid;
      // FIX: نضمن وجود مستند userRoles أولاً عشان تنجح عملية updateUser بعدين
      // (Rules بتحتاج مستند userRoles عشان تسمح للأدمن بالكتابة)
      if (window.FirebaseAuthService.ensureUserRoleDoc) {
        window.FirebaseAuthService.ensureUserRoleDoc(uid, user.role, user.name).then(() => {
          syncWithAppsScript('updateUser', { id: user.id, authUid: uid, role: user.role }).catch(err => {
            console.error('فشل حفظ authUid في Firestore:', err);
          });
        }).catch(err => {
          console.error('فشل إنشاء userRoles في مرحلة الإصلاح:', err);
        });
      } else {
        syncWithAppsScript('updateUser', { id: user.id, authUid: uid, role: user.role }).catch(err => {
          console.error('فشل حفظ authUid في Firestore:', err);
        });
      }
    }
  }

  if (!user) {
    // شبكة أمان إضافية: قبل ما نستسلم ونعتبر إن مفيش بروفايل للمستخدم خالص،
    // نتأكد بالبحث المباشر في Firestore (مش بس في db.users المحمّلة في الذاكرة)،
    // لأن لو loadAllData() فشلت جزئياً أو لسه مكملتش، db.users ممكن تكون فاضية
    // مؤقتاً حتى لو المستخدم فعلياً موجود بالفعل في قاعدة البيانات. البحث المباشر
    // ده بيمنع إنشاء بروفايل مكرر جديد كل مرة تسجيل دخول لنفس الحساب.
    try {
      const directQuery = await window.firebaseDB.collection('users').where('authUid', '==', uid).limit(1).get();
      if (!directQuery.empty) {
        user = directQuery.docs[0].data();
        console.warn(`تم إيجاد المستخدم "${user.username}" عن طريق بحث مباشر في Firestore (احتياطي).`);
        if (!db.users.find(u => u.id === user.id)) {
          db.users.push(user);
        }
      }
    } catch (e) {
      console.error("فشل البحث المباشر عن المستخدم في Firestore:", e);
    }
  }

  if (!user) {
    // FIX: ميزة الإنشاء التلقائي لبروفايل الأدمن المفقود
    // لو المستخدم مسجل دخول ومالهوش ملف في users، بس ليه مستند في userRoles بيقول إنه ADMIN،
    // بنعمله ملف بروفايل تلقائي بدل ما نطلعه بره، عشان يحل مشكلة "أول أدمن" للنظام.
    try {
      const roleDoc = await window.firebaseDB.collection('userRoles').doc(uid).get();
      if (roleDoc.exists && roleDoc.data().role === 'ADMIN') {
        console.warn("الأدمن الحالي ملوش بروفايل في مجموعة users. جاري إنشاء بروفايل تلقائي...");
        const adminUsername = email.split('@')[0]; // نستخدم الجزء الأول من الإيميل كاسم مستخدم
        user = {
          id: `usr-admin-${Date.now()}`,
          authUid: uid,
          name: 'مدير النظام (تلقائي)',
          username: adminUsername,
          phone: '',
          role: 'ADMIN',
          area: 'المركز الرئيسي'
        };
        db.users.push(user);
        // نحفظه في Firestore كمان عشان المرة الجاية يتلاقى عادي
        await syncWithAppsScript('addUser', user);
      }
    } catch (e) {
      console.error("فشل التحقق من دور المستخدم أو إنشاء بروفايل تلقائي:", e);
    }
  }

  if (!user) {
    showLoginError('⚠️ تم التحقق من هويتك بنجاح، لكن لا يوجد ملف مستخدم مرتبط بحسابك في النظام. تواصل مع المشرف.');
    setLoginLoading(false);
    if (window.FirebaseAuthService) await window.FirebaseAuthService.signOut();
    return;
  }

  currentUser = user;
  hideLoginScreen();
  updateUIForRole();
  resetIdleTimer(); // IMPROVEMENT #6: نبدأ مراقبة الخمول فور نجاح تسجيل الدخول
  document.getElementById('current-user-display').textContent = `${user.name} (${user.role})`;
  document.getElementById('header-username').textContent = user.name;
  const avatarEl = document.getElementById('sidebar-user-avatar');
  if (avatarEl) avatarEl.textContent = (user.name || '').trim().charAt(0) || '؟';

  // فتح الصفحة الأخيرة النشطة المفتوحة مسبقاً أو فتح لوحة القيادة كوضع افتراضي
  let savedTab = localStorage.getItem('sky_erp_active_tab') || 'dashboard';
  if (user.role === 'COLLECTOR') {
    savedTab = 'collections';
  }
  switchTab(savedTab);
}

// تسجيل الخروج الفعلي: يقفل جلسة Firebase Authentication نفسها، مش بس واجهة الاستخدام
async function handleUserLogout() {
  currentUser = null;
  firebaseSubscriptionActive = false;
  stopIdleTimer(); // IMPROVEMENT #6: نوقف مؤقت الخمول لما المستخدم يخرج بنفسه

  // FIX: قفل كل الـ 18 onSnapshot listener الفعلية قبل الخروج. قبل كده كان
  // بيتم تصفير الـ flag بس من غير ما تتقفل الـ listeners الحقيقية، فكانت
  // تفضل شغالة في الخلفية وتتضاعف مع كل دورة دخول/خروج جديدة.
  if (typeof firebaseUnsubscribeUpdates === 'function') {
    firebaseUnsubscribeUpdates();
    firebaseUnsubscribeUpdates = null;
  }

  try {
    if (window.FirebaseAuthService) await window.FirebaseAuthService.signOut();
  } catch (e) {
    console.error('Sign out error:', e);
  }
  // showLoginScreen() سيتم استدعاؤه تلقائياً عبر حدث firebase-auth-changed (signedIn: false)
}

// ================= IMPROVEMENT #6: تسجيل خروج تلقائي عند الخمول (Idle Session Timeout) =================
// النظام بيتعامل مع فلوس وبيانات عملاء حساسة، ومفيش أي حماية قبل كده لو حد
// سايب الجهاز مسجل دخول وماشي (خصوصاً على أجهزة مشتركة في الفرع). دلوقتي
// بعد فترة خمول (بدون حركة ماوس/لمس/كتابة) بيظهر تحذير قبل الخروج بدقيقة،
// ولو مفيش أي تفاعل بيتم تسجيل الخروج تلقائياً. المدة قابلة للتحكم من
// الإعدادات (db.settings.sessionTimeoutMinutes)، وتسيبها صفر يعطّل الميزة.
let idleTimerHandle = null;
let idleWarningTimerHandle = null;
const IDLE_WARNING_LEAD_MS = 60 * 1000; // نعرض التحذير قبل الخروج الفعلي بدقيقة واحدة

function getSessionTimeoutMs() {
  const minutes = Number(db.settings && db.settings.sessionTimeoutMinutes);
  if (!minutes || isNaN(minutes) || minutes <= 0) return 0; // 0 = الميزة متعطلة
  return minutes * 60 * 1000;
}

function stopIdleTimer() {
  clearTimeout(idleTimerHandle);
  clearTimeout(idleWarningTimerHandle);
  idleTimerHandle = null;
  idleWarningTimerHandle = null;
  document.getElementById('idle-timeout-warning-dialog')?.remove();
}

function resetIdleTimer() {
  if (!currentUser) return;
  clearTimeout(idleTimerHandle);
  clearTimeout(idleWarningTimerHandle);
  document.getElementById('idle-timeout-warning-dialog')?.remove();

  const totalMs = getSessionTimeoutMs();
  if (totalMs <= 0) return; // الميزة متعطلة من الإعدادات

  const warningLead = Math.min(IDLE_WARNING_LEAD_MS, Math.floor(totalMs / 2));
  idleWarningTimerHandle = setTimeout(showIdleTimeoutWarning, Math.max(0, totalMs - warningLead));
}

function showIdleTimeoutWarning() {
  if (!currentUser) return;
  document.getElementById('idle-timeout-warning-dialog')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'idle-timeout-warning-dialog';
  overlay.className = 'system-dialog fixed inset-0 z-[10000] flex items-center justify-center p-4';
  const card = document.createElement('section');
  card.className = 'system-dialog-card w-full max-w-md rounded-2xl p-5 sm:p-6';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');

  const iconEl = document.createElement('div');
  iconEl.className = 'system-dialog-icon';
  iconEl.style.color = '#f59e0b';
  iconEl.innerHTML = `<i class="ph ph-clock-countdown text-2xl"></i>`;
  const titleEl = document.createElement('h3');
  titleEl.className = 'system-dialog-title';
  titleEl.textContent = 'هل ما زلت موجوداً؟';
  const messageEl = document.createElement('p');
  messageEl.className = 'system-dialog-message';
  messageEl.id = 'idle-timeout-countdown-text';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'system-dialog-button';
  button.textContent = 'نعم، أكمل الجلسة';
  button.style.background = '#0f766e';
  button.addEventListener('click', () => resetIdleTimer());

  card.append(iconEl, titleEl, messageEl, button);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => button.focus());

  let secondsLeft = Math.ceil(Math.min(IDLE_WARNING_LEAD_MS, getSessionTimeoutMs() / 2) / 1000);
  const updateCountdown = () => {
    if (messageEl) messageEl.textContent = `لعدم وجود أي نشاط، هيتم تسجيل خروجك تلقائياً خلال ${secondsLeft} ثانية لأسباب أمنية.`;
  };
  updateCountdown();
  const countdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (!document.getElementById('idle-timeout-warning-dialog')) { clearInterval(countdownInterval); return; }
    if (secondsLeft <= 0) { clearInterval(countdownInterval); return; }
    updateCountdown();
  }, 1000);

  idleTimerHandle = setTimeout(async () => {
    document.getElementById('idle-timeout-warning-dialog')?.remove();
    await handleUserLogout();
    showSystemAlert('تم تسجيل خروجك تلقائياً لعدم النشاط لفترة طويلة، لأسباب أمنية.', 'انتهت الجلسة');
  }, Math.min(IDLE_WARNING_LEAD_MS, getSessionTimeoutMs() / 2));
}

// نراقب أي نشاط حقيقي من المستخدم (كتابة/كليك/لمس/سكرول) ونعيد ضبط المؤقت،
// لكن بـ throttle بسيط (مش أكتر من مرة كل ثانيتين) عشان مانعملش آلاف
// setTimeout/clearTimeout مع كل حركة ماوس بسيطة.
let lastIdleResetAt = 0;
function handleUserActivityForIdleTimer() {
  if (!currentUser) return;
  if (document.getElementById('idle-timeout-warning-dialog')) return; // من غير ما نلغي تحذير ظاهر فعلاً
  const now = Date.now();
  if (now - lastIdleResetAt < 2000) return;
  lastIdleResetAt = now;
  resetIdleTimer();
}
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
  document.addEventListener(evt, handleUserActivityForIdleTimer, { passive: true });
});

function updateUIForRole() {
  const isCollector = currentUser && currentUser.role === 'COLLECTOR';
  
  // 1. إظهار/إخفاء العناصر الخاصة بالمشرف فقط
  const adminEls = document.querySelectorAll('.admin-only');
  adminEls.forEach(el => {
    if (isAdmin()) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
  
  // 2. إخفاء التبويبات غير المصرح بها حسب دور المستخدم وصلاحياته الدقيقة
  const sidebarLinks = document.querySelectorAll('#sidebar-menu a');
  sidebarLinks.forEach(link => {
    const tab = link.getAttribute('data-tab');
    if (isTabAllowedForCurrentUser(tab)) {
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  });
  
  // 3. تحديث شارة دور المستخدم في أعلى الصفحة
  const roleBadge = document.getElementById('header-role-badge');
  if (roleBadge) {
    if (isAdmin()) {
      roleBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-teal-600 animate-ping"></span>الوصول: مشرف (ADMIN)';
      roleBadge.className = 'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full text-[11px] md:text-xs font-bold bg-teal-50 text-teal-700 border border-teal-100';
    } else if (isCollector) {
      roleBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-blue-600 animate-ping"></span>الوصول: محصل (COLLECTOR)';
      roleBadge.className = 'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full text-[11px] md:text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100';
    } else {
      roleBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-600"></span>الوصول: ${currentUser ? currentUser.role : 'مجهول'}`;
      roleBadge.className = 'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full text-[11px] md:text-xs font-bold bg-slate-50 text-slate-700 border border-slate-100';
    }
  }
}

function initDatabase() {
  // التعديل الجديد: تم إلغاء الاعتماد على LocalStorage كمصدر أساسي للبيانات.
  // النظام الآن يبدأ بقاعدة بيانات فارغة (defaultSeedData) وينتظر التحميل من Firebase.
  // هذا يضمن عدم ظهور بيانات قديمة أو مختفية عند فتح الموقع.
  
  db = JSON.parse(JSON.stringify(defaultSeedData)); // نسخة نظيفة من البيانات الافتراضية
  db.settings.offlineMode = false;
  
  // ملاحظة: لا نقوم بالتحميل من localStorage هنا لضمان دقة البيانات من السحابة مباشرة.
  // يتم استخدام localStorage فقط كذاكرة مؤقتة جداً أثناء الجلسة الواحدة.
  
  applyCompanyBranding();
  updateSyncStatusUI();
}

// ملاحظة: تم إلغاء تخزين نسخة كاملة من قاعدة البيانات (عملاء/عقود/خزينة) في
// sessionStorage نهائياً: كانت بتتخزن كنص عادي (plaintext) بعد كل عملية، وبعد
// فحص الكود بالكامل تأكدنا إن مفيش أي مكان بيقرأها تاني أصلاً (البيانات
// بتيجي دايماً من Firebase مباشرة عبر initDatabase). دالة saveToLocalStorage()
// الفارغة اللي كانت بتتنادى من 62 مكان اتشالت بالكامل مع كل استدعاءاتها
// (كانت no-op مش بتعمل حاجة أصلاً) — راجع تقرير الـ Code Audit للتفاصيل.

// ================= BACKUP & RESTORE SYSTEM =================
window.exportBackup = function() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
  
  const backupPayload = {
    _meta: {
      version: '1.0',
      system: 'SKY ERP',
      createdAt: now.toISOString(),
      createdBy: getCurrentUserName(),
      label: `نسخة احتياطية - ${dateStr}`
    },
    data: {
      clients: db.clients,
      inventory: db.inventory,
      brands: db.brands,
      suppliers: db.suppliers,
      supplierTransactions: db.supplierTransactions,
      productCategories: db.productCategories,
      products: db.products,
      productStockMovements: db.productStockMovements,
      contracts: db.contracts,
      installments: db.installments,
      collectorCustodies: db.collectorCustodies,
      treasuryTransactions: db.treasuryTransactions,
      users: db.users,
      auditLogs: db.auditLogs,
      investors: db.investors,
      investorSnapshots: db.investorSnapshots,
      settings: db.settings
    }
  };

  const jsonStr = JSON.stringify(backupPayload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SKY_ERP_Backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  localStorage.setItem('sky_erp_last_backup_date', new Date().toISOString().split('T')[0]);
  logAction('نسخ احتياطي', `تم تصدير نسخة احتياطية كاملة: ${backupPayload._meta.label}`);
  showToast('✅ تم حفظ النسخة الاحتياطية بنجاح!', 'success');
};

// ================= EXCEL BACKUP EXPORT (Archival / Review) =================
// تصدير نسخة Excel منظمة لكل بيانات النظام (شيت منفصل لكل قسم) عشان تتفتح
// بسهولة في Excel للمراجعة، الأرشفة، أو الطباعة. ده منفصل تماماً عن نسخة
// الـ JSON الاحتياطية اللي بتُستخدم للاسترجاع الفعلي داخل النظام.
window.exportExcelBackup = function() {
  if (typeof XLSX === 'undefined') {
    showToast('❌ تعذر تحميل مكتبة تصدير Excel. تأكد من اتصال الإنترنت وحاول تحديث الصفحة.', 'error');
    return;
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  const nowLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const statusLabels = {
    available: 'متاح', sold_installment: 'مباع بالتقسيط', sold_cash: 'مباع كاش', maintenance: 'تحت الصيانة',
    active: 'ساري', completed: 'مكتمل', cancelled: 'ملغي', settled_early: 'مسدد مبكراً', defaulted: 'متعثر (تم الاسترجاع)', upgraded: 'تم ترقيته لجهاز جديد',
    pending: 'قيد الانتظار', paid: 'مدفوع', approved: 'معتمد', rejected: 'مرفوض'
  };
  const typeLabels = {
    deposit: 'إيداع / رأس مال', expense: 'مصروفات خارجية', collection: 'تحصيل أقساط',
    cash_sale: 'بيع كاش فوري', inventory_purchase: 'شراء بضاعة ومخزون',
    product_purchase: 'شراء منتجات (أصناف عامة)', product_sale: 'بيع منتج (صنف عام)',
    supplier_payment: 'سداد دفعة لمورد',
    capital_injection: 'ضخ رأس مال (مستثمر)', capital_withdrawal: 'سحب رأس مال (مستثمر)',
    profit_withdrawal: 'سحب أرباح (مستثمر)'
  };
  const roleLabels = { ADMIN: 'مشرف عام', COLLECTOR: 'محصل' };
  const L = (map, val) => map[val] || val || '';

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  const addSheet = (name, rows) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(12, k.length + 4) }));
    // تثبيت صف العناوين لما تفتح أي ورقة، عشان تفضل العناوين ظاهرة وانت
    // بتنزل لتحت في صفوف كتير.
    ws['!sheetViews'] = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  // 1. ملخص عام
  // FIX: كان بيجمع t.amount مباشرة من غير حماية، فأي حركة خزينة واحدة
  // برقم تالف/فاضي كانت بتحول الإجمالي كله لـ NaN فورًا (لأن أي رقم + NaN
  // = NaN). دلوقتي بنستخدم safeAmount() زي باقي الحسابات في البرنامج،
  // اللي بترجع 0 لأي قيمة تالفة بدل ما تبوّظ الإجمالي كله.
  const totalTreasury = db.treasuryTransactions.reduce((s, t) => s + safeAmount(t), 0);
  // FIX: كانت بتتجاهل حركات استرداد الحذف (type 'in' لمصروف/شراء اتلغى،
  // type 'out' لتحصيل اتلغى) - فحذف مصروف أو عقد كان يصحح رصيد الخزينة
  // الكلي بس مش الأرقام دي في تقرير التصدير.
  const totalSales = db.treasuryTransactions.filter(t => t.type === 'cash_sale' || t.type === 'collection' || t.type === 'product_sale' || t.type === 'out').reduce((s, t) => s + safeAmount(t), 0);
  const totalExpenses = Math.abs(db.treasuryTransactions.filter(t => t.type === 'expense' || t.type === 'inventory_purchase' || t.type === 'product_purchase' || t.type === 'supplier_payment' || t.type === 'in').reduce((s, t) => s + safeAmount(t), 0));
  const overdueInsts = db.installments.filter(i => i.status !== 'paid' && new Date(i.dueDate) < now).length;
  addSheet('ملخص عام', [{
    'اسم الشركة': db.settings.companyName || 'شركة SKY',
    'تاريخ التصدير': nowLabel,
    'رصيد الخزينة الحالي (ج.م)': totalTreasury,
    'إجمالي المبيعات والتحصيلات (ج.م)': totalSales,
    'إجمالي المصروفات والمشتريات (ج.م)': totalExpenses,
    'عدد العملاء': db.clients.length,
    'عدد الأجهزة بالمخزون': db.inventory.length,
    'عدد العقود': db.contracts.length,
    'عدد الأقساط المتأخرة': overdueInsts,
    'عدد المستخدمين': db.users.length,
    'طلبات عملاء مفتوحة': db.customerRequests.filter(r => r.status === 'pending' || r.status === 'found').length,
    'طلبات سحب معلّقة': db.pendingWithdrawals.filter(w => w.status === 'pending').length,
    'عدد أسماء القائمة السوداء': db.blacklist.length
  }]);

  // 2. العملاء والضامنين
  addSheet('العملاء والضامنين', db.clients.map(c => ({
    'الاسم': c.name, 'الرقم القومي': c.nationalId, 'الهاتف': c.phone, 'العنوان': c.address,
    'اسم الضامن': c.guarantorName, 'رقم قومي الضامن': c.guarantorNationalId, 'هاتف الضامن': c.guarantorPhone,
    'صلة القرابة': c.guarantorRelation, 'وظيفة الضامن': c.guarantorJob, 'عنوان الضامن': c.guarantorAddress
  })));

  // 2ب. سجل متابعة العملاء
  addSheet('سجل متابعة العملاء', sortByTimestampDesc([...db.clientFollowUps]).map(n => ({
    'العميل': n.clientName, 'سبب التأخير': n.delayReason || '', 'الملاحظة': n.note, 'تاريخ المتابعة القادمة': n.nextFollowUpDate || '',
    'بواسطة': n.createdBy, 'التاريخ والوقت': n.timestamp
  })));

  // 2ج. طلبات العملاء (منتجات غير متوفرة)
  const requestStatusLabels = { pending: 'لسه بيتم البحث', found: 'تم إيجاده', fulfilled: 'تم التحويل لبيع', cancelled: 'اعتذر العميل' };
  addSheet('طلبات العملاء', sortByTimestampDesc([...db.customerRequests]).map(r => ({
    'اسم الطالب': r.clientName, 'الهاتف': r.clientPhone || '', 'المنتج المطلوب': r.productDescription,
    'الحالة': L(requestStatusLabels, r.status), 'ملاحظات': r.notes || '', 'بواسطة': r.createdBy, 'التاريخ': r.timestamp
  })));

  // 2د. القائمة السوداء
  addSheet('القائمة السوداء', sortByTimestampDesc([...db.blacklist]).map(b => ({
    'الاسم': b.name, 'الرقم القومي': b.nationalId || '', 'الهاتف': b.phone || '',
    'السبب': b.reason || '', 'أضافه': b.addedBy, 'التاريخ': b.timestamp
  })));

  // 3. المخزون والأجهزة
  addSheet('المخزون والأجهزة', db.inventory.map(d => ({
    'الماركة': d.brand, 'الموديل': d.name, 'السيريال': d.serial, 'سعر التكلفة': d.costPrice,
    'سعر البيع': d.sellingPrice, 'المورد': d.supplier, 'الفرع': d.branch || '', 'حالة القطعة': d.condition || '',
    'الضمان (شهر)': d.warrantyMonths || 0, 'تاريخ الإضافة': d.addedDate || '',
    'الحالة': L(statusLabels, d.status), 'بيع لـ': d.soldTo || '', 'ملاحظات': d.notes || ''
  })));

  // 4. العقود
  addSheet('العقود', db.contracts.map(c => ({
    'رقم العقد': (c.id || '').replace('con-', ''), 'العميل': c.clientName, 'هاتف العميل': c.clientPhone,
    'الجهاز': c.deviceInfo, 'إجمالي قيمة العقد': c.totalValue, 'المقدم': c.downPayment,
    'المتبقي': c.remainingAmount, 'القسط الشهري': c.monthlyInstallment, 'عدد الأقساط': c.duration,
    'المحصل': c.collectorName, 'تاريخ البداية': c.startDate, 'الحالة': L(statusLabels, c.status)
  })));

  // 5. الأقساط
  addSheet('الأقساط', db.installments.map(i => ({
    'رقم العقد': (i.contractId || '').replace('con-', ''), 'العميل': i.clientName, 'هاتف العميل': i.clientPhone,
    'الضامن': i.guarantorName, 'المحصل': i.collectorName, 'رقم القسط': i.installmentNum,
    'المبلغ': i.amount, 'تاريخ الاستحقاق': i.dueDate, 'الحالة': L(statusLabels, i.status),
    'المبلغ المدفوع': i.paidAmount, 'تاريخ الدفع': i.paidDate || '', 'رقم الإيصال': i.receiptId || '',
    'غرامة التأخير': i.delayFines || 0
  })));

  // 6. عهد المحصلين
  addSheet('عهد المحصلين', db.collectorCustodies.map(c => ({
    'المحصل': c.collectorName, 'العميل': c.clientName, 'رقم العقد': (c.contractId || '').replace('con-', ''),
    'المبلغ': c.amount, 'التاريخ': c.date, 'الحالة': L(statusLabels, c.status)
  })));

  // 7. حركات الخزينة (الأحدث أولاً)
  addSheet('حركات الخزينة', sortByTimestampDesc([...db.treasuryTransactions]).map(t => ({
    'التاريخ والوقت': t.timestamp, 'النوع': L(typeLabels, t.type), 'البيان': t.notes, 'المبلغ': t.amount
  })));

  // 7ب. المصروفات
  addSheet('المصروفات', sortByTimestampDesc([...db.expenses]).map(e => ({
    'الفئة': e.category, 'المبلغ': e.amount, 'التاريخ': e.date, 'الوصف': e.description || '', 'بواسطة': e.paidBy || ''
  })));

  // 7ج. المصروفات الشهرية الثابتة
  addSheet('المصروفات الشهرية الثابتة', db.recurringExpenses.map(r => ({
    'الفئة': r.category, 'القيمة الشهرية': r.amount, 'مفعّل؟': r.active !== false ? 'نعم' : 'لا',
    'آخر شهر اتسجل فيه': r.lastAppliedMonth || 'لسه محصلش', 'بواسطة': r.createdBy, 'تاريخ الإنشاء': r.timestamp
  })));

  // 7د. تسوية الخزينة اليومية
  addSheet('تسوية الخزينة اليومية', sortByTimestampDesc([...db.cashReconciliations]).map(r => ({
    'التاريخ': r.date, 'الرصيد المتوقع': r.expectedAmount, 'الرصيد الفعلي': r.actualAmount,
    'الفرق': r.difference, 'ملاحظات': r.notes || '', 'بواسطة': r.performedBy, 'وقت التسجيل': r.timestamp
  })));

  // 8. المستخدمين (بدون كلمة المرور لأسباب أمنية)
  addSheet('المستخدمين', db.users.map(u => ({
    'الاسم': u.name, 'اسم المستخدم': u.username, 'الصلاحية': L(roleLabels, u.role),
    'الهاتف': u.phone, 'المنطقة': u.area || ''
  })));

  // 8ب. تصنيفات المنتجات
  addSheet('تصنيفات المنتجات', db.productCategories.map(cat => ({
    'اسم التصنيف': cat.name, 'ملاحظات': cat.notes || ''
  })));

  // 9. الماركات والموردين
  addSheet('الماركات والموردين', (() => {
    const rows = [];
    const maxLen = Math.max(db.brands.length, db.suppliers.length);
    for (let i = 0; i < maxLen; i++) {
      const brandObj = db.brands[i];
      const brandCat = brandObj ? db.productCategories.find(c => c.id === brandObj.categoryId) : null;
      rows.push({
        'الماركة': brandObj ? brandObj.name : '',
        'الصنف التابع له': brandCat ? brandCat.name : '',
        'اسم المورد': db.suppliers[i] ? db.suppliers[i].name : '',
        'هاتف المورد': db.suppliers[i] ? db.suppliers[i].phone : '',
        'ملاحظات': db.suppliers[i] ? (db.suppliers[i].notes || '') : ''
      });
    }
    return rows;
  })());

  // 9ب. أرصدة الموردين
  addSheet('أرصدة الموردين', db.suppliers.map(s => {
    const bal = computeSupplierBalance(s.id);
    return {
      'اسم المورد': s.name, 'الهاتف': s.phone, 'العنوان': s.address || '',
      'طريقة التعامل': s.type === 'cash' ? 'كاش' : s.type === 'both' ? 'كاش/آجل' : 'آجل',
      'إجمالي المشتريات': bal.totalPurchases, 'إجمالي المسدد': bal.totalPaid,
      'الرصيد المستحق': bal.balance, 'ملاحظات': s.notes || ''
    };
  }));

  // 9ج. حركات الموردين (كشف حساب تفصيلي)
  addSheet('حركات الموردين', sortByTimestampDesc(db.supplierTransactions).map(t => ({
    'التاريخ': t.timestamp, 'المورد': t.supplierName,
    'نوع الحركة': t.type === 'purchase' ? 'شراء بضاعة' : (t.type === 'return' ? 'مرتجع للمورد' : 'سداد دفعة'),
    'طريقة الدفع': (t.type === 'purchase' || t.type === 'return') ? (t.method === 'credit' ? 'آجل' : 'كاش') : 'سداد نقدي',
    'المبلغ': t.amount, 'ملاحظات': t.notes || ''
  })));

  // 9د. الأصناف والمنتجات العامة (إكسسوارات/قطع غيار)
  addSheet('الأصناف والمنتجات', db.products.map(p => {
    const cat = db.productCategories.find(c => c.id === p.categoryId);
    const qty = computeProductQuantity(p.id);
    const sup = db.suppliers.find(s => s.id === p.defaultSupplierId);
    return {
      'الصنف': cat ? cat.name : '', 'اسم المنتج': p.name, 'الوحدة': p.unit || 'قطعة',
      'الكمية الحالية': qty, 'الحد الأدنى للتنبيه': p.minQty || 0,
      'سعر التكلفة': p.costPrice || 0, 'سعر البيع': p.sellingPrice || 0,
      'المورد الافتراضي': sup ? sup.name : '', 'ملاحظات': p.notes || ''
    };
  }));

  // 9هـ. حركات المنتجات (وارد/صادر)
  addSheet('حركات المنتجات', sortByTimestampDesc(db.productStockMovements).map(m => ({
    'التاريخ': m.timestamp, 'المنتج': m.productName,
    'نوع الحركة': m.type === 'in' ? 'وارد (شراء)' : 'صادر',
    'السبب': m.reason || '', 'الكمية': m.quantity,
    'سعر الوحدة': m.unitCost || 0, 'الإجمالي': m.totalCost || 0,
    'المورد': m.supplierName || '', 'ملاحظات': m.notes || ''
  })));

  // 10. سجل التدقيق (الأحدث أولاً)
  addSheet('سجل التدقيق', sortByTimestampDesc([...db.auditLogs]).map(l => ({
    'التاريخ والوقت': l.timestamp, 'المستخدم': l.user, 'نوع العملية': l.actionType, 'التفاصيل': l.details
  })));

  // 11. المستثمرون ورأس المال
  const investorStats = computeInvestorFinancials();
  addSheet('المستثمرون ورأس المال', investorStats.investors.map(inv => ({
    'اسم المستثمر': inv.name, 'تاريخ الانضمام': inv.joinDate || '', 'رأس المال': inv.capitalAmount || 0,
    'نسبة ثابتة؟': (inv.fixedSharePercent !== undefined && inv.fixedSharePercent !== null && inv.fixedSharePercent !== '') ? 'نعم' : 'لا',
    'نسبة الملكية %': Number(inv.sharePercent.toFixed(2)), 'نصيبه من الربح': Math.round(inv.profitShare),
    'المسحوب فعلياً': inv.withdrawn, 'المتبقي له': Math.round(inv.remainingDue), 'ملاحظات': inv.notes || ''
  })));

  // 11ب. تجميدات أرباح المستثمرين
  addSheet('تجميدات أرباح المستثمرين', sortByTimestampDesc([...db.investorSnapshots]).map(s => ({
    'التاريخ': s.timestamp, 'صافي الربح المجمّد': Math.round(s.netProfit),
    'إجمالي رأس المال وقتها': Math.round(s.totalCapital), 'إجمالي المسحوب وقتها': Math.round(s.totalWithdrawn),
    'عدد المستثمرين وقتها': (s.perInvestor || []).length
  })));

  // 11ج. طلبات السحب المعلّقة (موافقة أدمن تاني)
  const withdrawalTypeLabels = { capital_withdrawal: 'سحب رأس مال', profit_withdrawal: 'سحب أرباح' };
  const withdrawalStatusLabels = { pending: 'معلّق - محتاج موافقة', approved: 'تمت الموافقة والتنفيذ', rejected: 'مرفوض' };
  addSheet('طلبات السحب المعلّقة', sortByTimestampDesc([...db.pendingWithdrawals]).map(w => ({
    'المستثمر': w.investorName, 'نوع السحب': L(withdrawalTypeLabels, w.type), 'المبلغ': w.amount,
    'الحالة': L(withdrawalStatusLabels, w.status), 'طلبه': w.requestedBy, 'التاريخ': w.timestamp, 'ملاحظات': w.notes || ''
  })));

  XLSX.writeFile(wb, `SKY_ERP_Excel_${dateStr}.xlsx`);

  localStorage.setItem('sky_erp_last_backup_date', new Date().toISOString().split('T')[0]);
  logAction('نسخ احتياطي', `تم تصدير نسخة Excel منظمة للمراجعة والأرشفة`);
  showToast('✅ تم تصدير ملف Excel بنجاح!', 'success');
};

window.triggerRestoreBackup = function() {
  // Open confirmation modal first
  const modal = document.getElementById('backup-restore-confirm-modal');
  if (modal) modal.classList.remove('hidden');
};

window.confirmRestoreBackup = function() {
  const modal = document.getElementById('backup-restore-confirm-modal');
  if (modal) modal.classList.add('hidden');
  // Trigger file picker
  const fileInput = document.getElementById('backup-restore-file-input');
  if (fileInput) fileInput.click();
};

window.handleRestoreFileSelected = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);

      // Validate it's a SKY ERP backup
      if (!parsed._meta || parsed._meta.system !== 'SKY ERP' || !parsed.data) {
        showToast('❌ الملف المختار ليس نسخة احتياطية صحيحة لنظام SKY ERP!', 'error');
        return;
      }

      const restoredData = parsed.data;
      const meta = parsed._meta;

      // Restore all data
      if (restoredData.clients) db.clients = restoredData.clients;
      if (restoredData.inventory) db.inventory = restoredData.inventory;
      if (restoredData.brands) db.brands = restoredData.brands;
      if (restoredData.suppliers) db.suppliers = restoredData.suppliers;
      if (restoredData.supplierTransactions) db.supplierTransactions = restoredData.supplierTransactions;
      if (restoredData.productCategories) db.productCategories = restoredData.productCategories;
      if (restoredData.products) db.products = restoredData.products;
      if (restoredData.productStockMovements) db.productStockMovements = restoredData.productStockMovements;
      if (restoredData.contracts) db.contracts = restoredData.contracts;
      if (restoredData.installments) db.installments = restoredData.installments;
      if (restoredData.collectorCustodies) db.collectorCustodies = restoredData.collectorCustodies;
      if (restoredData.treasuryTransactions) db.treasuryTransactions = restoredData.treasuryTransactions;
      if (restoredData.users) db.users = restoredData.users;
      if (restoredData.auditLogs) db.auditLogs = restoredData.auditLogs;
      if (restoredData.investors) db.investors = restoredData.investors;
      if (restoredData.investorSnapshots) db.investorSnapshots = restoredData.investorSnapshots;
      if (restoredData.settings) {
        // Preserve current connection settings, only restore data-related settings
        const currentConnectionSettings = {
          offlineMode: db.settings.offlineMode
        };
        db.settings = { ...restoredData.settings, ...currentConnectionSettings };
        if (!db.settings.staffPermissions) db.settings.staffPermissions = getDefaultStaffPermissions();
        if (!db.settings.collectorPermissions) db.settings.collectorPermissions = getDefaultCollectorPermissions();
      }

      applyCompanyBranding();
      updateSyncStatusUI();
      renderAllTabs();

      logAction('استرجاع نسخة احتياطية', `تم استرجاع النسخة: ${meta.label} (أنشئت بواسطة: ${meta.createdBy})`);
      showToast(`✅ تم استرجاع النسخة الاحتياطية بنجاح! (${escapeHTML(meta.label)})`, 'success');

    } catch (err) {
      showToast('❌ خطأ في قراءة الملف. تأكد أنه ملف JSON صحيح!', 'error');
      console.error('Restore error:', err);
    }
    // Reset file input so user can pick same file again if needed
    event.target.value = '';
  };
  reader.readAsText(file, 'utf-8');
};

function showToast(message, type = 'success') {
  // Remove existing toasts
  document.querySelectorAll('.sky-toast').forEach(t => t.remove());
  
  const colors = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
    info: 'bg-teal-600 text-white',
    warning: 'bg-amber-500 text-white'
  };
  
  const toast = document.createElement('div');
  toast.className = `sky-toast fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-6 py-3 rounded-2xl shadow-2xl text-sm font-bold flex items-center gap-2 ${colors[type] || colors.success} transition-all duration-300`;
  toast.style.transform = 'translateX(-50%) translateY(20px)';
  toast.style.opacity = '0';
  toast.innerHTML = message;
  document.body.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
  });
  
  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ترتيب أي مصفوفة بيانات فيها timestamp بصيغة "YYYY-MM-DD HH:MM" بحيث يكون الأحدث دايماً في الأول.
// اتعملت الدالة دي عشان لما البيانات تيجي من Firebase (سواء تحميل أولي أو تحديث لحظي)
// بترجع من غير ترتيب مضمون، فكنا بنعرضها زي ما هي فيبان الترتيب عشوائي (مش الأحدث في الأول).
function sortByTimestampDesc(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.sort((a, b) => {
    const ta = a && a.timestamp ? a.timestamp : '';
    const tb = b && b.timestamp ? b.timestamp : '';
    if (ta === tb) return 0;
    return ta > tb ? -1 : 1;
  });
}

// ================= IMPROVEMENT #1: الأداء مع البيانات الكبيرة =================
// (١) Debounce عام لأي خانة بحث: بدل ما نعيد رسم الجدول/القائمة الكاملة مع
// كل ضغطة حرف (وده كان بيسبب بطء محسوس مع بيانات كبيرة، خصوصاً في تبويب
// العملاء لأنه كان بيحسب درجة خطورة كل عميل من جديد على كل ضغطة)، دلوقتي
// بننتظر المستخدم يوقف عن الكتابة لمدة قصيرة (300ms) قبل ما نعيد الرسم فعلياً.
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// (٢) Pagination عام: بدل ما نرسم كل صفوف/بطاقات القائمة دفعة واحدة (اللي
// بيبقى تقيل جداً مع مئات/آلاف السجلات)، بنقسّمها لصفحات ونعرض صفحة واحدة
// بس في كل مرة، مع أزرار "السابق/التالي" بتتحدث تلقائياً تحت أي جدول أو
// قائمة نستخدمها معاها. الحالة (رقم الصفحة الحالية) بتتخزن هنا بمفتاح مميز
// لكل تبويب (key) عشان كل تبويب يحتفظ برقم صفحته لوحده.
const paginationState = {};
const PAGE_SIZE_DEFAULT = 25;

function paginate(key, allItems, afterElementId, onChangeCallback, pageSize = PAGE_SIZE_DEFAULT) {
  if (!paginationState[key]) paginationState[key] = 1;
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (paginationState[key] > totalPages) paginationState[key] = totalPages;
  const page = paginationState[key];
  const start = (page - 1) * pageSize;
  const pageItems = allItems.slice(start, start + pageSize);
  renderPaginationControls(key, page, totalPages, totalItems, afterElementId, onChangeCallback, pageSize);
  return pageItems;
}

function renderPaginationControls(key, page, totalPages, totalItems, afterElementId, onChangeCallback, pageSize) {
  const afterEl = document.getElementById(afterElementId);
  if (!afterEl) return;
  let pagerEl = document.getElementById(`pager-${key}`);
  if (!pagerEl) {
    pagerEl = document.createElement('div');
    pagerEl.id = `pager-${key}`;
    pagerEl.className = 'flex items-center justify-between gap-3 px-4 py-3 flex-wrap border-t border-slate-100';
    afterEl.insertAdjacentElement('afterend', pagerEl);
  }
  window.__paginationCallbacks = window.__paginationCallbacks || {};
  window.__paginationCallbacks[key] = onChangeCallback;

  if (totalItems === 0) { pagerEl.innerHTML = ''; return; }
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(totalItems, page * pageSize);

  if (totalPages <= 1) {
    pagerEl.innerHTML = `<span class="text-xs text-slate-400">عرض ${from}–${to} من إجمالي ${totalItems.toLocaleString()}</span>`;
    return;
  }

  pagerEl.innerHTML = `
    <span class="text-xs text-slate-500">عرض ${from}–${to} من إجمالي ${totalItems.toLocaleString()} — صفحة ${page} من ${totalPages}</span>
    <div class="flex items-center gap-1.5">
      <button ${page <= 1 ? 'disabled' : ''} onclick="window.__paginationGoto('${key}', ${page - 1})" class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${page <= 1 ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-400' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}">‹ السابق</button>
      <button ${page >= totalPages ? 'disabled' : ''} onclick="window.__paginationGoto('${key}', ${page + 1})" class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${page >= totalPages ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-400' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}">التالي ›</button>
    </div>
  `;
}

window.__paginationGoto = function (key, page) {
  paginationState[key] = page;
  if (window.__paginationCallbacks && window.__paginationCallbacks[key]) {
    window.__paginationCallbacks[key]();
  }
};

// أي فلترة/بحث لازم يرجّع صفحة القائمة لأول صفحة (وإلا ممكن المستخدم يفضل
// واقف في صفحة رقم 5 مثلاً بعد ما يبحث ويطلع نتيجة صفحة واحدة بس فاضية).
function resetPage(key) {
  paginationState[key] = 1;
}

function logAction(actionType, details) {
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const userName = getCurrentUserName();
  
  db.auditLogs.unshift({
    user: userName,
    actionType: actionType,
    details: details,
    timestamp: timestamp
  });
  
  if (db.auditLogs.length > 100) db.auditLogs.pop();
  
  syncWithAppsScript('addAuditLog', { user: userName, actionType, details, timestamp });
}

function applyCompanyBranding() {
  const name = db.settings.companyName || 'شركة SKY';
  const logo = db.settings.companyLogo || '';

  document.getElementById('company-name-display').textContent = name;
  document.getElementById('header-company-subtitle').textContent = `تتابع الآن لوحة التحكم المالية الموحدة والرقابة الإدارية الذكية لمبيعات التقسيط وحسابات الأمانة لدى ${name}.`;
  document.title = `${name} - نظام إدارة الأقساط والخزينة المتكامل`;

  const mobileNameEl = document.getElementById('mobile-company-name');
  if (mobileNameEl) mobileNameEl.textContent = name;

  const logoIcon = document.getElementById('company-logo-icon');
  const logoImg = document.getElementById('company-logo-img');
  
  if (logo) {
    logoIcon.classList.add('hidden');
    logoImg.src = logo;
    logoImg.classList.remove('hidden');
  } else {
    logoIcon.classList.remove('hidden');
    logoImg.classList.add('hidden');
  }
}

// Show/hide mobile topbar based on screen size
function handleMobileTopbar() {
  const topbar = document.getElementById('mobile-topbar');
  if (!topbar) return;
  // ميظهرش شريط الموبايل العلوي خالص لو لسه واقفين على شاشة التحقق من الجلسة
  // أو شاشة تسجيل الدخول - عشان ميبانش "بايظ" أو ظاهر تحت شاشة الدخول
  const sessionOverlay = document.getElementById('session-check-overlay');
  const loginOverlay = document.getElementById('login-overlay');
  const stillOnAuthScreen = (sessionOverlay && !sessionOverlay.classList.contains('hidden')) ||
                             (loginOverlay && !loginOverlay.classList.contains('hidden'));
  if (stillOnAuthScreen) {
    topbar.style.display = 'none';
    return;
  }
  if (window.innerWidth < 769) {
    topbar.style.display = 'flex';
  } else {
    topbar.style.display = 'none';
    closeMobileSidebar && closeMobileSidebar();
  }
}
window.addEventListener('resize', handleMobileTopbar);


// ================= BACKEND FIREBASE SYNC =================
async function syncWithAppsScript(action, payload = {}) {
  // If Firebase is available, sync to Firestore
  if (window.FirebaseService && window.FirebaseService.isAvailable()) {
    const result = await window.FirebaseService.syncAction(action, payload);
    // لو الحفظ الفعلي في Firestore فشل (صلاحيات Rules، اتصال، إلخ)، العملية
    // كانت بتفضل ظاهرة محلياً بس بتختفي بعد أي Refresh لأنها فعلياً معملتش
    // Save على السيرفر. دلوقتي بننبّه المستخدم فوراً بدل الصمت.
    if (!result.success) {
      console.error(`فشل حفظ العملية "${action}" في Firebase:`, result.error || result.reason);
      showSyncFailureWarning(action, result.error || result.reason);
    }
    return result;
  }
  return { success: true, offline: true };
}

// تنبيه مرئي عند فشل أي عملية مزامنة فعلياً مع Firestore
let lastSyncFailureDetail = null;
function showSyncFailureWarning(action, errorDetail) {
  lastSyncFailureDetail = { action, errorDetail: errorDetail || 'خطأ غير معروف', time: new Date().toLocaleTimeString('ar-EG') };
  const headerBadge = document.getElementById('header-sync-badge');
  if (headerBadge) {
    headerBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-600 animate-ping"></span><span>فشل حفظ آخر عملية! (دوس هنا) ⚠️</span>`;
    headerBadge.className = 'shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full text-[11px] md:text-xs font-bold transition-all duration-200 bg-rose-50 text-rose-700 border border-rose-200 cursor-pointer';
    headerBadge.onclick = showLastSyncFailureDetail;
    headerBadge.title = `فشلت عملية "${action}": ${errorDetail || 'خطأ غير معروف'}. البيانات ظاهرة عندك حالياً لكنها لسه ما اتحفظتش فعلياً في قاعدة البيانات، وممكن تختفي لو عملت Refresh. تأكد من صلاحيات Firestore واتصال الإنترنت.`;
  }
  console.warn(`⚠️ تنبيه: عملية "${action}" ظاهرة عندك محلياً بس ما اتحفظتش في Firestore. لو عملت Refresh دلوقتي ممكن تضيع.`);
}

// دالة تعرض تفاصيل آخر خطأ حفظ بوضوح (Alert) عشان تظهر على الموبايل كمان، مش بس Tooltip
window.showLastSyncFailureDetail = function() {
  if (!lastSyncFailureDetail) return;
  alert(`⚠️ فشلت آخر عملية حفظ في Firebase\n\nنوع العملية: ${lastSyncFailureDetail.action}\nالوقت: ${lastSyncFailureDetail.time}\n\nرسالة الخطأ بالظبط:\n${lastSyncFailureDetail.errorDetail}\n\nمن فضلك اعمل Screenshot للرسالة دي وابعتها.`);
};

async function loadFromServer() {
  const statusMsg = document.getElementById('connection-status-msg');
  if (statusMsg) statusMsg.innerHTML = '<span class="text-teal-600">جاري تحميل البيانات من السحابة...</span>';

  // Use Firebase if initialized
  if (window.FirebaseService && window.FirebaseService.isAvailable()) {
    try {
      const fbData = await window.FirebaseService.loadAllData();
      if (fbData) {
        db.clients = fbData.clients || [];
        db.inventory = fbData.inventory || [];
        db.productCategories = fbData.productCategories || [];
        db.products = fbData.products || [];
        db.productStockMovements = fbData.productStockMovements || [];
        db.contracts = fbData.contracts || [];
        db.installments = fbData.installments || [];
        db.collectorCustodies = fbData.collectorCustodies || [];
        db.treasuryTransactions = sortByTimestampDesc(fbData.treasuryTransactions || []);
        db.users = fbData.users || [];
        db.auditLogs = sortByTimestampDesc(fbData.auditLogs || []);
        db.investors = fbData.investors || [];
        db.investorSnapshots = sortByTimestampDesc(fbData.investorSnapshots || []);
        db.expenses = fbData.expenses || [];
        db.clientFollowUps = fbData.clientFollowUps || [];
        db.customerRequests = fbData.customerRequests || [];
        db.recurringExpenses = fbData.recurringExpenses || [];
        db.pendingWithdrawals = fbData.pendingWithdrawals || [];
        db.cashReconciliations = fbData.cashReconciliations || [];
        db.blacklist = fbData.blacklist || [];
        db.suppliers = fbData.suppliers || [];
        db.supplierTransactions = fbData.supplierTransactions || [];
        // تنظيف ذاتي: أي ماركة قديمة كانت متخزنة كنص خام (من نظام قديم قبل
        // ربط الماركات بالأصناف) بنستبعدها من القائمة الفعّالة، لأنها مش
        // مرتبطة بأي صنف فمش هتظهر صح في النظام الهرمي الحالي (صنف ← ماركة
        // ← منتج). بياناتها القديمة في المخزون (لو موجودة) مش بتتأثر لأن
        // كل قطعة مخزون بتخزن اسم الماركة كنص مباشرة في نفسها.
        const rawBrands = fbData.brands || [];
        db.brands = rawBrands.filter(b => typeof b === 'object' && b !== null && b.categoryId);
        if (fbData.settings) {
          db.settings = { ...db.settings, ...fbData.settings };
        }
        
        renderAllTabs();
        
        if (statusMsg) statusMsg.innerHTML = '<span class="text-emerald-600">تمت المزامنة بنجاح (Firebase)!</span>';
        updateSyncStatusUI();
        
        // إذا كان هذا هو التحميل الأول بعد تسجيل الدخول، نتأكد من إخفاء أي شاشات تحميل
        const overlay = document.getElementById('session-check-overlay');
        if (overlay) overlay.classList.add('hidden');
        
        return;
      }
    } catch (e) {
      console.error("Firebase load error", e);
    }
  }

  if (statusMsg) statusMsg.innerHTML = '<span class="text-amber-600">النظام يعمل بالوضع المحلي.</span>';
  updateSyncStatusUI();
}


function updateSyncStatusUI() {
  const headerBadge = document.getElementById('header-sync-badge');
  const settingsBadge = document.getElementById('sync-status-badge');
  
  const isFirebaseAvailable = window.FirebaseService && window.FirebaseService.isAvailable();
  const isOffline = db.settings.offlineMode && !isFirebaseAvailable;
  
  let text = '';
  let badgeClass = '';
  let icon = '';
  
  if (isOffline) {
    text = 'وضع محاكاة أوفلاين ⚠️';
    badgeClass = 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/55';
    icon = '<i class="ph ph-warning animate-pulse"></i>';
  } else if (isFirebaseAvailable) {
    text = 'متصل بقاعدة Firebase سحابياً 🟢';
    badgeClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/55';
    icon = '<span class="w-2 h-2 rounded-full bg-emerald-600 animate-ping"></span>';
  } else {
    text = 'متصل بالخادم المحلي 🟢';
    badgeClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/55';
    icon = '<span class="w-2 h-2 rounded-full bg-emerald-600 animate-ping"></span>';
  }
  
  if (headerBadge) {
    headerBadge.innerHTML = `${icon}<span>${text}</span>`;
    headerBadge.className = `shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full text-[11px] md:text-xs font-bold transition-all duration-200 ${badgeClass}`;
  }
  
  if (settingsBadge) {
    settingsBadge.innerHTML = `${icon}<span>${text}</span>`;
    settingsBadge.className = `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 ${badgeClass}`;
  }
}

// ================= DYNAMIC CALCULATIONS (OVERDUE FINES) =================
function calculateFinesForInstallment(inst, contract) {
  if (inst.status === 'paid') return inst.delayFines || 0;
  
  const today = new Date();
  const due = new Date(inst.dueDate);
  const diffTime = today - due;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays <= contract.graceDays) {
    return 0;
  }
  
  if (contract.fineType === 'flat') {
    // FIX (تقرير الفحص - بند ٤.٥): كانت الغرامة الثابتة بتتحسب على كامل
    // أيام التأخير من تاريخ الاستحقاق (diffDays) شاملة أيام فترة السماح
    // نفسها، بعكس النوع النسبي (percent) اللي بيحسب فقط الأيام اللي بعد
    // فترة السماح. دلوقتي النوعين متوافقين: الغرامة تُحسب فقط عن الأيام
    // الزايدة عن فترة السماح، فمفيش ازدواج في محاسبة أيام السماح نفسها.
    const overdueDaysAfterGrace = diffDays - contract.graceDays;
    return parseFloat((overdueDaysAfterGrace * contract.fineValue).toFixed(2));
  } else if (contract.fineType === 'percent') {
    // غرامة شهرية بنسبة مئوية (مش تراكم يومي): أول 29 يوم تأخير (بعد فترة
    // السماح) غرامتهم صفر، يوم 30 بيُحسب أول شهر كامل غرامة، وتفضل ثابتة
    // لحد يوم 60 (شهرين)، يوم 90 (3 شهور)... وهكذا كل 30 يوم شهر إضافي.
    const monthsElapsed = Math.floor(diffDays / 30);
    return parseFloat((inst.amount * (contract.fineValue / 100) * monthsElapsed).toFixed(2));
  }
  return 0;
}

function getInstallmentOverdueStatus(inst) {
  const contract = db.contracts.find(c => c.id === inst.contractId);
  if (!contract) return { statusText: 'خطأ بالعقد', overdueDays: 0, fine: 0, totalDue: inst.amount, statusColor: 'badge-danger' };

  if (inst.status === 'paid') {
    return {
      statusText: 'تم السداد',
      overdueDays: 0,
      fine: inst.delayFines || 0,
      totalDue: inst.amount,
      statusColor: 'badge-success'
    };
  }

  // أي مبلغ اتحصّل جزئياً قبل كده على القسط ده (من غير ما يوصل لكامل المبلغ
  // المطلوب) بيتخصم من "المتبقي" في كل مكان بنعرض فيه المبلغ المطلوب تحصيله.
  const alreadyPaid = safeNum(inst.paidAmount);
  const partialPrefix = alreadyPaid > 0 ? `(مسدد جزئياً ${alreadyPaid.toLocaleString()} ج.م) ` : '';

  const today = new Date();
  const due = new Date(inst.dueDate);
  const diffTime = today - due;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return {
      statusText: `${partialPrefix}بالانتظار موعد الاستحقاق`,
      overdueDays: 0,
      fine: 0,
      totalDue: Math.max(0, inst.amount - alreadyPaid),
      statusColor: alreadyPaid > 0 ? 'badge-warning' : 'badge-info'
    };
  }

  const fine = calculateFinesForInstallment(inst, contract);
  const totalDue = inst.amount + fine;

  if (diffDays <= contract.graceDays) {
    return {
      statusText: `${partialPrefix}متأخر (${diffDays} يوم) - بفترة السماح`,
      overdueDays: diffDays,
      fine: 0,
      totalDue: Math.max(0, inst.amount - alreadyPaid),
      statusColor: 'badge-warning'
    };
  }

  return {
    statusText: `${partialPrefix}متأخر (${diffDays} يوم) - خارج السماح`,
    overdueDays: diffDays,
    fine: fine,
    totalDue: Math.max(0, totalDue - alreadyPaid),
    statusColor: 'badge-danger'
  };
}

// ================= TAB RENDERING ENGINES =================
function renderActiveTab(tabName) {
  switch (tabName) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'clients':
      renderClients();
      break;
    case 'customer-requests':
      renderCustomerRequests();
      break;
    case 'client-balances':
      renderClientBalances();
      break;
    case 'inventory':
      renderInventory();
      break;
    case 'suppliers':
      renderSuppliers();
      break;
    case 'products':
      renderProducts();
      break;
    case 'contracts':
      renderContracts();
      break;
    case 'collections':
      renderCollections();
      break;
    case 'collection-followups':
      renderCollectionFollowUps();
      break;
    case 'treasury':
      renderTreasury();
      break;
    case 'investors':
      renderInvestors();
      break;
    case 'expenses':
      renderExpenses();
      break;
    case 'today-reminders':
      renderTodayReminders();
      break;
    case 'reports':
      renderReports();
      break;
    case 'users':
      renderUsers();
      break;
    case 'audit-log':
      renderAuditLog();
      break;
    case 'settings':
      renderSettings();
      break;
  }
}

function renderAllTabs() {
  const activeTabBtn = document.querySelector('#sidebar-menu a.nav-link-active');
  if (activeTabBtn) {
    const tabName = activeTabBtn.getAttribute('data-tab');
    renderActiveTab(tabName);
  }
  // تحديث القوائم المنسدلة في نماذج الإضافة دائماً عند وصول بيانات جديدة
  populateDropdowns();
  updateNotificationBell();
}


// --- 1. DASHBOARD ---
let financialChartInstance = null;

// حماية بسيطة: لو مستند حركة خزينة واحد بس اتخزن فيه amount فاضي/مش رقم
// (غالباً حركة تجريبية اتحفظت بالغلط)، متخليش الرقم ده يلوّث كل مجاميع
// الداشبورد ويحولها NaN. أي قيمة غير صالحة بتتحسب كـ 0 بدل ما توقف الحساب كله.
function safeAmount(tx) {
  const n = Number(tx.amount);
  return Number.isFinite(n) ? n : 0;
}

// نفس فكرة safeAmount بالظبط، بس لأي قيمة رقم مباشرة (مش لازم تكون جوه
// حقل amount) — بنستخدمها في تحصين باقي الحسابات المالية الحساسة (قيمة
// الأجهزة، قيمة العقود، رأس مال المستثمرين...) ضد أي قيمة تالفة/فاضية.
function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

window.applyDashboardDateFilter = function() {
  const from = document.getElementById('dashboard-filter-from').value;
  const to = document.getElementById('dashboard-filter-to').value;
  if (!from || !to) {
    alert('⚠️ من فضلك حدد تاريخي "من" و"إلى" الاثنين معاً.');
    return;
  }
  if (from > to) {
    alert('⚠️ تاريخ "من" لازم يكون قبل تاريخ "إلى".');
    return;
  }
  renderDashboard();
};

window.setDashboardDateRange = function(range) {
  const toLocalDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const today = new Date();
  const from = new Date(today);
  if (range === 'week') from.setDate(today.getDate() - 6);
  if (range === 'month') from.setDate(1);
  document.getElementById('dashboard-filter-from').value = toLocalDateKey(from);
  document.getElementById('dashboard-filter-to').value = toLocalDateKey(today);
  renderDashboard();
};

window.resetDashboardDateFilter = function() {
  document.getElementById('dashboard-filter-from').value = '';
  document.getElementById('dashboard-filter-to').value = '';
  renderDashboard();
};

function renderDashboard() {
  const dashboardUsername = document.getElementById('dashboard-username');
  if (dashboardUsername) dashboardUsername.textContent = getCurrentUserName() || 'فريق SKY';

  // FIX: التحية كانت ثابتة على "صباح الخير" طول الوقت. دلوقتي بتتغيّر حسب
  // ساعة الجهاز الفعلية: صباح الخير من الفجر لحد قبل الظهر، وبعد كده مساء
  // الخير لحد آخر اليوم.
  const greetingEl = document.getElementById('dashboard-greeting');
  if (greetingEl) {
    const currentHour = new Date().getHours();
    greetingEl.textContent = (currentHour >= 5 && currentHour < 12) ? 'صباح الخير' : 'مساء الخير';
  }
  // فلتر الفترة (اختياري): لو الأدمن حدد "من - إلى" في أعلى الداشبورد،
  // بنفلتر بيه بس مؤشرات "النشاط" (مبيعات/تحصيلات/مصروفات/ربح) لأنها بس
  // اللي منطقي تتحسب لفترة معينة. الرصيد والمخزون والمستحقات "حالة حالية"
  // بتفضل كل الوقت زي ما هي بغض النظر عن الفلتر.
  const fromVal = document.getElementById('dashboard-filter-from')?.value;
  const toVal = document.getElementById('dashboard-filter-to')?.value;
  const hasFilter = !!(fromVal && toVal);
  const inRange = (dateStr) => {
    if (!hasFilter) return true;
    const d = (dateStr || '').substring(0, 10);
    return d >= fromVal && d <= toVal;
  };
  const filteredTx = db.treasuryTransactions.filter(tx => inRange(tx.timestamp));
  const filteredContracts = db.contracts.filter(c => inRange(c.startDate));

  const labelEl = document.getElementById('dashboard-filter-active-label');
  if (labelEl) {
    if (hasFilter) {
      labelEl.textContent = `📅 عرض نشاط الفترة: ${fromVal} → ${toVal}`;
      labelEl.classList.remove('hidden');
    } else {
      labelEl.classList.add('hidden');
    }
  }

  const totalTreasury = db.treasuryTransactions.reduce((sum, tx) => sum + safeAmount(tx), 0);
  document.getElementById('kpi-treasury-balance').textContent = `${totalTreasury.toLocaleString()} ج.م`;
  
  // FIX: كانت بتحسب بس بيع الأجهزة كاش (cash_sale) وتتجاهل بيع الأصناف
  // العامة كاش (product_sale) - نفس مشكلة صافي الربح بالظبط لكن في مكان تاني.
  const directSales = filteredTx.filter(tx => tx.type === 'cash_sale' || tx.type === 'product_sale').reduce((sum, tx) => sum + safeAmount(tx), 0);
  const contractSales = filteredContracts.reduce((sum, c) => sum + safeNum(c.totalValue), 0);
  const totalSales = directSales + contractSales;
  document.getElementById('kpi-total-sales').textContent = `${totalSales.toLocaleString()} ج.م`;

  // FIX: صافي الربح كان بيحسب بس تحصيلات الأقساط (collection) وبيتجاهل
  // البيع الكاش (cash_sale) تمامًا، فكل عملية بيع جهاز كاش كانت بتظهر
  // كأنها "خسارة صافية" في الداشبورد رغم إنها فعلاً مبلغ اتحصّل ورجع
  // للشركة. دلوقتي بنحسب التحصيلات الفعلية = تحصيل أقساط + بيع كاش.
  // FIX: صافي الربح كان بيحسب تحصيل الأقساط + بيع الأجهزة كاش بس، وكان
  // لسه بيتجاهل بيع الأصناف/الإكسسوارات العامة كاش (product_sale) رغم إن
  // شراءها (product_purchase) بيتحسب كمصروف - فبيع صنف عام كاش كان بيظهر
  // كخسارة صافية رغم إنه فلوس فعلاً رجعت للشركة.
  // FIX: أي عملية حذف (مصروف، عقد، جهاز من المخزون) بتنشئ حركة "استرداد"
  // تصحح رصيد الخزينة (type: 'in' بيلغي أثر مصروف/شراء سابق، type: 'out'
  // بيلغي أثر تحصيل/مقدم سابق) - بس الحركات دي كانت بتتجاهل تمامًا من
  // حسابات "صافي الربح"/"إجمالي المبيعات"/"إجمالي المصروفات"، فالحذف كان
  // بيصحح الرصيد الكلي بس من غير ما ينعكس على الأرقام دي. دلوقتي بقت
  // متضمنة، فأي حذف بيتصحح في كل مكان مرة واحدة.
  const activeCollections = filteredTx.filter(tx => tx.type === 'collection' || tx.type === 'cash_sale' || tx.type === 'product_sale' || tx.type === 'out').reduce((sum, tx) => sum + safeAmount(tx), 0);
  document.getElementById('kpi-active-collections').textContent = `${activeCollections.toLocaleString()} ج.م`;

  const totalExpenses = Math.abs(filteredTx.filter(tx => tx.type === 'expense' || tx.type === 'inventory_purchase' || tx.type === 'product_purchase' || tx.type === 'supplier_payment' || tx.type === 'in').reduce((sum, tx) => sum + safeAmount(tx), 0));
  document.getElementById('kpi-total-expenses').textContent = `${totalExpenses.toLocaleString()} ج.م`;

  // حساب صافي التدفق النقدي للفترة = إجمالي التحصيلات - إجمالي المصروفات والمشتريات
  // ملحوظة: ده مقياس تدفق نقدي (Cash Flow) مش "ربح" بالمعنى المحاسبي، لأنه
  // بيحسب قيمة شراء المخزون كاملة كمصروف فوري بدل ما يفرق بين تكلفة البضاعة
  // المباعة والمخزون اللي لسه موجود - شوف كارت "الربح المُحقَّق" تحت للرقم
  // الصحيح محاسبياً (نفس رقم تبويب المستثمرين بالظبط).
  const netProfit = activeCollections - totalExpenses;
  const netProfitEl = document.getElementById('kpi-net-profit');
  if (netProfitEl) {
    netProfitEl.textContent = `${netProfit.toLocaleString()} ج.م`;
    // تلوين الرقم حسب الخسارة أو الربح
    if (netProfit < 0) {
      netProfitEl.classList.remove('text-emerald-700');
      netProfitEl.classList.add('text-rose-600');
    } else {
      netProfitEl.classList.remove('text-rose-600');
      netProfitEl.classList.add('text-emerald-700');
    }
  }

  // FEATURE: كارت "الربح المُحقَّق" الجديد - بيستخدم بالظبط نفس دالة تبويب
  // المستثمرين (computeRealizedSalesProfit) عشان يبقى فيه رقم "ربح" واحد
  // متطابق في كل شاشات النظام، بدل رقمين مختلفين بنفس الاسم يلخبطوا صاحب
  // النظام. ده رقم تراكمي (كل الوقت)، مش متأثر بفلتر الفترة فوق.
  const realizedProfitEl = document.getElementById('kpi-realized-profit');
  if (realizedProfitEl) {
    const realized = computeRealizedSalesProfit();
    realizedProfitEl.textContent = `${Math.round(realized.netRealizedProfit).toLocaleString()} ج.م`;
    realizedProfitEl.classList.toggle('text-rose-600', realized.netRealizedProfit < 0);
  }

  const totalSuppliersDue = db.suppliers.reduce((sum, s) => sum + computeSupplierBalance(s.id).balance, 0);
  const suppliersDueEl = document.getElementById('kpi-suppliers-due');
  if (suppliersDueEl) suppliersDueEl.textContent = `${totalSuppliersDue.toLocaleString()} ج.م`;

  let totalOverdueVal = 0;
  let overdueCount = 0;
  db.installments.forEach(inst => {
    if (inst.status !== 'paid') {
      const stats = getInstallmentOverdueStatus(inst);
      if (stats.overdueDays > 0) {
        totalOverdueVal += stats.totalDue;
        overdueCount++;
      }
    }
  });
  document.getElementById('kpi-overdue-installments').textContent = `${totalOverdueVal.toLocaleString()} ج.م`;
  
  const overdueContainer = document.getElementById('kpi-overdue-container');
  const overdueAlertText = document.getElementById('kpi-overdue-alert-text');
  const overdueIconBg = document.getElementById('kpi-overdue-icon-bg');
  
  if (totalOverdueVal > 0) {
    overdueContainer.classList.add('border-red-400', 'bg-red-50/20');
    overdueIconBg.className = 'p-3 bg-red-100 text-red-600 rounded-xl animate-pulse-warning';
    overdueAlertText.innerHTML = `<span class="flex items-center gap-1"><i class="ph ph-warning"></i> يوجد عدد ${overdueCount} قسط متأخر بالذمة</span>`;
  } else {
    overdueContainer.classList.remove('border-red-400', 'bg-red-50/20');
    overdueIconBg.className = 'p-3 bg-amber-50 text-amber-500 rounded-xl';
    overdueAlertText.innerHTML = `<span>كل الأقساط منتظمة بالكامل</span>`;
  }

  const inventoryCapital = db.inventory.filter(dev => dev.status === 'available' || dev.status === 'maintenance').reduce((sum, dev) => sum + safeNum(dev.costPrice), 0);
  document.getElementById('kpi-inventory-capital').textContent = `${inventoryCapital.toLocaleString()} ج.م`;

  // FIX (تقرير الفحص - بند ٣.١): نفس إصلاح computeInvestorFinancials -
  // بنخصم أي مبلغ سبق تحصيله جزئياً من القسط قبل عرضه كمتبقٍ متوقع.
  const totalRemainingContractBalance = db.installments.filter(inst => inst.status !== 'paid').reduce((sum, inst) => sum + Math.max(0, safeNum(inst.amount) - safeNum(inst.paidAmount)), 0);
  document.getElementById('kpi-expected-profits').textContent = `${totalRemainingContractBalance.toLocaleString()} ج.م`;

  const totalInsts = db.installments.length;
  const badDebtRate = totalInsts > 0 ? Math.round((overdueCount / totalInsts) * 100) : 0;
  document.getElementById('kpi-bad-debt-rate').textContent = `${badDebtRate}%`;
  document.getElementById('kpi-bad-debt-bar').style.width = `${badDebtRate}%`;

  const timeline = document.getElementById('dashboard-audit-timeline');
  timeline.innerHTML = '';
  sortByTimestampDesc(db.auditLogs).slice(0, 5).forEach(log => {
    let colorClass = 'bg-slate-200 text-slate-800';
    if (log.actionType.includes('إضافة') || log.actionType.includes('شراء')) colorClass = 'bg-teal-50 text-teal-700 border border-teal-100';
    if (log.actionType.includes('إنشاء') || log.actionType.includes('بيع') || log.actionType.includes('تعديل')) colorClass = 'bg-emerald-50 text-emerald-700 border border-emerald-100';
    if (log.actionType.includes('تحصيل') || log.actionType.includes('اعتماد')) colorClass = 'bg-blue-50 text-blue-700 border border-blue-100';
    if (log.actionType.includes('صرف')) colorClass = 'bg-rose-50 text-rose-700 border border-rose-100';

    const item = document.createElement('div');
    item.className = 'relative timeline-item flex gap-4 pr-6 pb-4';
    item.innerHTML = `
      <div class="absolute right-[9px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-400 z-10"></div>
      <div class="flex-1">
        <div class="flex justify-between items-start">
          <span class="text-xs font-semibold ${colorClass} px-2 py-0.5 rounded">${escapeHTML(log.actionType)}</span>
          <span class="text-[10px] text-slate-400 font-mono">${escapeHTML(log.timestamp)}</span>
        </div>
        <p class="text-xs text-slate-600 mt-1.5"><span class="font-bold text-slate-700">${escapeHTML(log.user)}</span>: ${escapeHTML(log.details)}</p>
      </div>
    `;
    timeline.appendChild(item);
  });

  const canvas = document.getElementById('financialTrendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (financialChartInstance) {
    financialChartInstance.destroy();
  }

  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو'];
  const salesData = [120000, 150000, 180000, 220000, 260000, totalSales];
  const collectionData = [80000, 110000, 130000, 160000, 200000, activeCollections];

  if (typeof Chart !== 'undefined') {
    // نضبط ألوان الشبكة والنصوص حسب الوضع الحالي (ليلي/نهاري) عشان الرسم
    // البياني يفضل واضح ومقروء في الحالتين، بدل ما يفضل بألوان النهار
    // الفاتحة فوق خلفية داكنة.
    const isDarkMode = document.documentElement.classList.contains('dark');
    const gridColor = isDarkMode ? 'rgba(148, 163, 184, 0.12)' : '#f1f5f9';
    const tickColor = isDarkMode ? '#a6b2c5' : '#64748b';

    const salesColor = isDarkMode ? '#9d8cf4' : '#6d5bd0';
    const collectionColor = isDarkMode ? '#5eead4' : '#0f9f8c';

    financialChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          {
            label: 'إجمالي المبيعات',
            data: salesData,
            borderColor: salesColor,
            backgroundColor: salesColor + '1a',
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: isDarkMode ? '#191b1f' : '#ffffff',
            pointBorderColor: salesColor,
            pointBorderWidth: 2
          },
          {
            label: 'إجمالي التحصيلات الفعالة',
            data: collectionData,
            borderColor: collectionColor,
            backgroundColor: collectionColor + '1a',
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: isDarkMode ? '#191b1f' : '#ffffff',
            pointBorderColor: collectionColor,
            pointBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Cairo', size: 11 }, color: tickColor }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              font: { family: 'Cairo', size: 10 }, color: tickColor,
              callback: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + ' ألف' : v)
            }
          }
        }
      }
    });
  } else {
    console.warn("Chart.js is not loaded. Skipping chart rendering.");
  }

  updateNotificationBell();
}

// ================= جرس التنبيهات (للأدمن فقط) =================
// بيجمع كل التنبيهات المهمة من أماكنها المختلفة في النظام في مكان واحد،
// بدل ما تكون متفرقة أو تظهر تلقائياً بشكل مزعج. الجرس نفسه بيتحدث في
// كل مرة يتغير فيها أي جزء من البيانات (بعد renderDashboard).
function getSystemNotifications() {
  const notifications = { overdue: null, dueToday: null, dueSoon: null, lowStock: null, pendingCustody: null, backupDue: null, openRequests: null, pendingRecurringExpenses: null, pendingWithdrawalApprovals: null };

  // 0. تذكير النسخة الاحتياطية: لو عدّى أكتر من 7 أيام من غير أي تصدير
  // (Excel أو JSON)، أو مفيش أي نسخة اتعملت من الأساس.
  const lastBackup = localStorage.getItem('sky_erp_last_backup_date');
  const daysSinceBackup = lastBackup
    ? Math.floor((new Date() - new Date(lastBackup)) / (1000 * 60 * 60 * 24))
    : Infinity;
  if (daysSinceBackup > 7) {
    notifications.backupDue = { days: lastBackup ? daysSinceBackup : null };
  }

  // 1. أقساط متأخرة فعلياً (نفس منطق كارت الداشبورد بالظبط)
  let overdueCount = 0, overdueAmount = 0;
  db.installments.forEach(inst => {
    if (inst.status !== 'paid') {
      const stats = getInstallmentOverdueStatus(inst);
      if (stats.overdueDays > 0) { overdueCount++; overdueAmount += stats.totalDue; }
    }
  });
  if (overdueCount > 0) notifications.overdue = { count: overdueCount, amount: overdueAmount };

  // 2. أقساط مستحقة اليوم (بإعادة استخدام دالة التنبيهات الصباحية الموجودة أصلاً)
  if (typeof getTodayDueStats === 'function') {
    const stats = getTodayDueStats();
    if (stats.totalCount > 0) notifications.dueToday = stats;
  }

  // 2.ب أقساط هتستحق خلال 3 أيام جايين (تذكير استباقي قبل ما العميل يتأخر أصلاً)
  if (typeof getUpcomingDueStats === 'function') {
    const stats = getUpcomingDueStats(3);
    if (stats.totalCount > 0) notifications.dueSoon = stats;
  }

  // 3. منتجات أوشكت على النفاد (نفس منطق باج "أوشك على النفاد" بالظبط)
  const lowStockProducts = db.products.filter(p => computeProductQuantity(p.id) <= (p.minQty || 0));
  if (lowStockProducts.length > 0) notifications.lowStock = { count: lowStockProducts.length, products: lowStockProducts };

  // 4. عهد محصلين معلّقة محتاجة اعتماد
  const pending = db.collectorCustodies.filter(c => c.status === 'pending');
  if (pending.length > 0) {
    const amount = pending.reduce((sum, c) => sum + safeAmount(c), 0);
    notifications.pendingCustody = { count: pending.length, amount };
  }

  // 5. طلبات عملاء لسه مفتوحة (لسه بيتم البحث أو تم إيجاده بس لسه محولش لبيع)
  const openRequests = db.customerRequests.filter(r => r.status === 'pending' || r.status === 'found');
  if (openRequests.length > 0) notifications.openRequests = { count: openRequests.length };

  // 6. مصروفات شهرية ثابتة لسه محتاجة تسجيل لشهر ده
  const pendingRecurring = db.recurringExpenses.filter(r => r.active !== false && r.lastAppliedMonth !== currentMonthKey());
  if (pendingRecurring.length > 0) notifications.pendingRecurringExpenses = { count: pendingRecurring.length };

  // 7. طلبات سحب كبيرة معلّقة تحتاج موافقة أدمن تاني
  const pendingWd = db.pendingWithdrawals.filter(w => w.status === 'pending');
  if (pendingWd.length > 0) notifications.pendingWithdrawalApprovals = { count: pendingWd.length };

  return notifications;
}

function updateNotificationBell() {
  const dot = document.getElementById('notif-bell-dot');
  const btn = document.getElementById('notif-bell-btn');
  if (!dot || !isAdmin()) return;
  const n = getSystemNotifications();
  const hasAny = n.overdue || n.dueToday || n.dueSoon || n.lowStock || n.pendingCustody || n.backupDue || n.openRequests || n.pendingRecurringExpenses || n.pendingWithdrawalApprovals;
  dot.classList.toggle('hidden', !hasAny);
  const itemCount = [n.overdue, n.dueToday, n.dueSoon, n.lowStock, n.pendingCustody, n.backupDue, n.openRequests, n.pendingRecurringExpenses, n.pendingWithdrawalApprovals].filter(Boolean).length;
  if (btn) btn.setAttribute('aria-label', hasAny ? `لديك ${itemCount} تنبيهات تحتاج للمراجعة` : 'لا توجد تنبيهات جديدة');

  // لو الجرس مفتوح وقت التحديث، نحدّث محتواه فوراً بدل ما يفضل قديم
  const panel = document.getElementById('notifications-panel');
  if (panel) renderNotificationsPanel(panel);
}

// ملاحظة: الشريط العلوي اللي فيه الجرس عنده overflow-x-auto (للتمرير الأفقي
// على الموبايل)، وده كان بيقصّ/يخفي أي عنصر position:absolute جواه. عشان
// كده بننشئ نافذة التنبيهات ديناميكياً ونضيفها لـ body مباشرة بموقع ثابت
// (fixed) محسوب من مكان الجرس نفسه، بدل ما تكون جوه الحاوية اللي بتقصّها.
window.toggleNotificationsPanel = function() {
  const existing = document.getElementById('notifications-panel');
  if (existing) {
    existing.remove();
    return;
  }

  const btn = document.getElementById('notif-bell-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const panel = document.createElement('div');
  panel.id = 'notifications-panel';
  panel.className = 'fixed w-80 max-w-[90vw] max-h-[calc(100dvh-1rem)] overflow-y-auto bg-white dark:bg-skyDark-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-skyDark-700 z-[9999] p-4 space-y-3';
  panel.style.top = `${window.innerWidth < 640 ? 8 : rect.bottom + 8}px`;
  // نحسب أقرب موقع يخلي النافذة كاملة ظاهرة جوه الشاشة (بدل ما تخرج برّه يمين/شمال)
  const panelWidth = Math.min(320, window.innerWidth * 0.9);
  let leftPos = rect.right - panelWidth;
  if (leftPos < 8) leftPos = 8;
  panel.style.left = `${leftPos}px`;
  document.body.appendChild(panel);
  renderNotificationsPanel(panel);
};

function renderNotificationsPanel(panel) {
  if (!panel) panel = document.getElementById('notifications-panel');
  if (!panel) return;
  const n = getSystemNotifications();
  const items = [];

  if (n.backupDue) {
    items.push(`
      <div class="p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/50 rounded-xl">
        <p class="text-xs font-bold text-purple-700 dark:text-purple-400">تذكير بالنسخة الاحتياطية</p>
        <p class="text-sm text-purple-600 dark:text-purple-400 mt-0.5">${n.backupDue.days ? `آخر نسخة احتياطية من ${n.backupDue.days} يوم` : 'لم يتم عمل أي نسخة احتياطية بعد'}</p>
        <button onclick="switchTab('settings'); toggleNotificationsPanel();" class="w-full mt-2 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold">اعمل نسخة احتياطية الآن</button>
      </div>`);
  }
  if (n.overdue) {
    items.push(`
      <div class="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/50 rounded-xl cursor-pointer" onclick="switchTab('collections'); toggleNotificationsPanel();">
        <p class="text-xs font-bold text-rose-700 dark:text-rose-400">أقساط متأخرة بالذمة</p>
        <p class="text-sm text-rose-600 dark:text-rose-400 mt-0.5">عدد ${n.overdue.count} قسط، بإجمالي ${n.overdue.amount.toLocaleString()} ج.م — اضغط للعرض</p>
      </div>`);
  }
  if (n.dueToday) {
    items.push(`
      <div class="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/50 rounded-xl">
        <p class="text-xs font-bold text-amber-700 dark:text-amber-400">أقساط مستحقة اليوم</p>
        <p class="text-sm text-amber-600 dark:text-amber-400 mt-0.5">عدد ${n.dueToday.totalCount} قسط، بإجمالي ${n.dueToday.totalDueAmount.toLocaleString()} ج.م</p>
        <div class="flex gap-2 mt-2">
          <button onclick="sendTodayDueRemindersInBulk()" class="flex-1 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold">إرسال تنبيهات جماعية</button>
          <button onclick="switchTab('today-reminders'); toggleNotificationsPanel();" class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">عرض التفاصيل</button>
        </div>
      </div>`);
  }
  if (n.dueSoon) {
    items.push(`
      <div class="p-3 bg-sky-50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/50 rounded-xl">
        <p class="text-xs font-bold text-sky-700 dark:text-sky-400">أقساط هتستحق خلال ${n.dueSoon.daysAhead} أيام</p>
        <p class="text-sm text-sky-600 dark:text-sky-400 mt-0.5">عدد ${n.dueSoon.totalCount} قسط، بإجمالي ${n.dueSoon.totalDueAmount.toLocaleString()} ج.م</p>
        <div class="flex gap-2 mt-2">
          <button onclick="sendUpcomingRemindersInBulk()" class="flex-1 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold">إرسال تذكير استباقي</button>
          <button onclick="switchTab('collections'); toggleNotificationsPanel();" class="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">عرض التفاصيل</button>
        </div>
      </div>`);
  }
  if (n.lowStock) {
    items.push(`
      <div class="p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/50 rounded-xl cursor-pointer" onclick="switchTab('products'); toggleNotificationsPanel();">
        <p class="text-xs font-bold text-orange-700 dark:text-orange-400">منتجات أوشكت على النفاد</p>
        <p class="text-sm text-orange-600 dark:text-orange-400 mt-0.5">${n.lowStock.count} صنف محتاج إعادة توريد — اضغط للعرض</p>
      </div>`);
  }
  if (n.pendingCustody) {
    items.push(`
      <div class="p-3 bg-sky-50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/50 rounded-xl cursor-pointer" onclick="switchTab('treasury'); toggleNotificationsPanel();">
        <p class="text-xs font-bold text-sky-700 dark:text-sky-400">عهد محصلين محتاجة اعتماد</p>
        <p class="text-sm text-sky-600 dark:text-sky-400 mt-0.5">${n.pendingCustody.count} عهدة، بإجمالي ${n.pendingCustody.amount.toLocaleString()} ج.م — اضغط للمراجعة</p>
      </div>`);
  }
  if (n.openRequests) {
    items.push(`
      <div class="p-3 bg-violet-50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/50 rounded-xl cursor-pointer" onclick="switchTab('customer-requests'); toggleNotificationsPanel();">
        <p class="text-xs font-bold text-violet-700 dark:text-violet-400">طلبات عملاء لسه مفتوحة</p>
        <p class="text-sm text-violet-600 dark:text-violet-400 mt-0.5">${n.openRequests.count} طلب مستني — اضغط للعرض</p>
      </div>`);
  }
  if (n.pendingRecurringExpenses) {
    items.push(`
      <div class="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/50 rounded-xl cursor-pointer" onclick="switchTab('expenses'); toggleNotificationsPanel(); setTimeout(() => openRecurringExpensesModal(), 200);">
        <p class="text-xs font-bold text-amber-700 dark:text-amber-400">مصروفات شهرية ثابتة لسه محتاجة تسجيل</p>
        <p class="text-sm text-amber-600 dark:text-amber-400 mt-0.5">${n.pendingRecurringExpenses.count} مصروف مستني لشهر ${currentMonthKey()} — اضغط للتسجيل</p>
      </div>`);
  }
  if (n.pendingWithdrawalApprovals) {
    items.push(`
      <div class="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/50 rounded-xl cursor-pointer" onclick="switchTab('investors'); toggleNotificationsPanel();">
        <p class="text-xs font-bold text-rose-700 dark:text-rose-400">طلبات سحب معلّقة تحتاج موافقة أدمن تاني</p>
        <p class="text-sm text-rose-600 dark:text-rose-400 mt-0.5">${n.pendingWithdrawalApprovals.count} طلب مستني — اضغط للمراجعة</p>
      </div>`);
  }

  panel.innerHTML = `
    <div class="flex items-center justify-between border-b border-slate-100 dark:border-skyDark-700 pb-2 mb-1">
      <h4 class="font-bold text-slate-800 dark:text-white text-sm">التنبيهات</h4>
      <button onclick="toggleNotificationsPanel()" class="text-slate-400 hover:text-slate-600"><i class="ph ph-x"></i></button>
    </div>
    ${items.length > 0 ? items.join('') : `
      <div class="p-4 text-center text-sm text-slate-400">
        <i class="ph ph-check-circle text-2xl text-emerald-500 mb-1"></i>
        <p>لا توجد تنبيهات حالياً، كل شيء على ما يرام ✨</p>
      </div>`}
  `;
}

// إغلاق قائمة التنبيهات لو المستخدم ضغط في أي مكان تاني بالصفحة
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifications-panel');
  const btn = document.getElementById('notif-bell-btn');
  if (!panel) return;
  if (btn && btn.contains(e.target)) return; // الضغط على الجرس نفسه بيتعامل معه toggleNotificationsPanel
  if (!panel.contains(e.target)) panel.remove();
});

// ================= البحث الشامل (من أي تبويب/مكان في النظام) =================
window.openGlobalSearch = function() {
  openModal('global-search-modal');
  const input = document.getElementById('global-search-input');
  input.value = '';
  document.getElementById('global-search-results').innerHTML = '<p class="text-center text-sm text-slate-400 p-6">اكتب أول حرفين على الأقل عشان تبدأ النتائج تظهر</p>';
  setTimeout(() => input.focus(), 100);
};

document.getElementById('global-search-input').addEventListener('input', (e) => {
  performGlobalSearch(e.target.value.trim());
});

function performGlobalSearch(query) {
  const resultsEl = document.getElementById('global-search-results');
  if (query.length < 2) {
    resultsEl.innerHTML = '<p class="text-center text-sm text-slate-400 p-6">اكتب أول حرفين على الأقل عشان تبدأ النتائج تظهر</p>';
    return;
  }
  const q = query.toLowerCase();
  const sections = [];

  // 1. العملاء (بالاسم، التليفون، الرقم القومي، أو اسم/تليفون الضامن)
  const clientMatches = db.clients.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.phone || '').includes(q) ||
    (c.nationalId || '').includes(q) ||
    (c.guarantorName || '').toLowerCase().includes(q) ||
    (c.guarantorPhone || '').includes(q)
  ).slice(0, 8);
  if (clientMatches.length > 0) {
    sections.push({
      title: 'العملاء',
      icon: 'ph-users',
      items: clientMatches.map(c => ({
        label: c.name,
        sub: c.phone || '',
        onClick: `closeModal('global-search-modal'); switchTab('clients'); viewClientDetails('${c.id}');`
      }))
    });
  }

  // 2. العقود (برقم العقد أو اسم العميل)
  const contractMatches = db.contracts.filter(c =>
    (c.id || '').toLowerCase().includes(q) ||
    (c.clientName || '').toLowerCase().includes(q)
  ).slice(0, 8);
  if (contractMatches.length > 0) {
    sections.push({
      title: 'العقود',
      icon: 'ph-file-text',
      items: contractMatches.map(c => ({
        label: `عقد ${c.clientName || ''}`,
        sub: c.id,
        onClick: `closeModal('global-search-modal'); switchTab('contracts'); viewContractDetails('${c.id}');`
      }))
    });
  }

  // 3. الأجهزة بالمخزون (بالسيريال أو الماركة/الموديل)
  const deviceMatches = db.inventory.filter(d =>
    (d.serial || '').toLowerCase().includes(q) ||
    (d.brand || '').toLowerCase().includes(q) ||
    (d.name || '').toLowerCase().includes(q)
  ).slice(0, 8);
  if (deviceMatches.length > 0) {
    sections.push({
      title: 'الأجهزة',
      icon: 'ph-device-mobile',
      items: deviceMatches.map(d => ({
        label: `${d.brand || ''} ${d.name || ''}`,
        sub: `SN: ${d.serial || '—'} — ${d.status === 'sold_installment' || d.status === 'sold_cash' ? 'مباع' : 'بالمخزن'}`,
        onClick: `closeModal('global-search-modal'); switchTab('inventory'); document.getElementById('inventory-search').value = '${(d.serial || d.name || '').replace(/'/g, "")}'; renderInventory();`
      }))
    });
  }

  if (sections.length === 0) {
    resultsEl.innerHTML = '<p class="text-center text-sm text-slate-400 p-6">مفيش نتائج مطابقة</p>';
    return;
  }

  resultsEl.innerHTML = sections.map(sec => `
    <div class="mb-2">
      <p class="text-[11px] font-bold text-slate-400 px-2 mb-1 flex items-center gap-1"><i class="ph ${sec.icon}"></i> ${sec.title}</p>
      ${sec.items.map(item => `
        <button type="button" onclick="${item.onClick}" class="w-full text-right px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-skyDark-800 flex flex-col transition-colors">
          <span class="text-sm font-semibold text-slate-800 dark:text-white">${escapeHTML(item.label)}</span>
          <span class="text-xs text-slate-400">${escapeHTML(item.sub)}</span>
        </button>
      `).join('')}
    </div>
  `).join('');
}

// --- 2. CLIENTS & GUARANTORS ---
function renderClients() {
  const searchVal = document.getElementById('client-search-input').value.toLowerCase();
  const tbody = document.getElementById('clients-table-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  const emptyState = document.getElementById('clients-empty-state');
  
  tbody.innerHTML = '';
  
  // FIX: كان الفلتر ده بيتعامل مع الاسم/الرقم القومي/الهاتف كـ"لازم يكونوا
  // موجودين دايماً" من غير أي حماية. أي عميل واحد بس (قديم أو مستورد) ناقصه
  // أي حقل من دول كان بيوقع الكود كله في خطأ برمجي بصمت، فتفضل الشاشة كلها
  // فاضية والعداد واقف على صفر - حتى لو العميل الجديد اتحفظ فعلاً بنجاح (عشان
  // كده كان بيظهر "مكرر" لو حاولت تضيفه تاني، رغم إنه مش ظاهر في القائمة).
  const filtered = db.clients.filter(c => 
    (c.name || '').toLowerCase().includes(searchVal) || 
    (c.nationalId || '').includes(searchVal) || 
    (c.phone || '').includes(searchVal)
  );

  document.getElementById('total-clients-count').textContent = db.clients.length;

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    renderPaginationControls('clients', 1, 1, 0, 'clients-table-wrapper', renderClients);
    return;
  }
  emptyState.classList.add('hidden');

  // IMPROVEMENT #1 (الأداء): بدل ما نرسم ونحسب خطورة كل عميل في القاعدة
  // كاملة، بنقسم النتائج المفلترة لصفحات (25 عميل بالصفحة) ونحسب/نرسم
  // صفحة واحدة بس في كل مرة. أي بحث بيرجّع الترقيم لأول صفحة تلقائياً.
  const pageItems = paginate('clients', filtered, 'clients-table-wrapper', renderClients);

  pageItems.forEach(c => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-colors';
    const risk = getClientRiskInfo(c.id);
    const riskBadgeHtml = (risk && risk.level !== 'none')
      ? `<span class="badge ${risk.badgeClass} mr-1 text-[10px] align-middle">${risk.level === 'high' ? '⚠️ عالي المخاطر' : 'له سوابق تأخير'}</span>`
      : '';
    tr.innerHTML = `
      <td class="p-4 font-bold text-slate-800">${escapeHTML(c.name)} ${riskBadgeHtml}</td>
      <td class="p-4 text-slate-500 font-mono">${escapeHTML(c.nationalId)}</td>
      <td class="p-4 font-mono">${escapeHTML(c.phone)}</td>
      <td class="p-4 text-slate-800">${escapeHTML(c.guarantorName) || '-'}</td>
      <td class="p-4 text-slate-500">${escapeHTML(c.guarantorRelation) || '-'}</td>
      <td class="p-4">
        ${c.locationUrl && /^https?:\/\//i.test(c.locationUrl) ? `<a href="${escapeHTML(c.locationUrl)}" target="_blank" class="text-teal-600 hover:text-teal-800 flex items-center gap-1 text-xs font-semibold"><i class="ph ph-map-pin-line"></i> عرض الخريطة</a>` : '<span class="text-slate-400">لا يوجد</span>'}
      </td>
      <td class="p-4 text-center">
        <div class="inline-flex gap-1.5">
          <button onclick="viewClientDetails('${c.id}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-semibold transition-all">الملف الكامل</button>
          <button onclick="openClientFollowUpModal('${c.id}')" class="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-chat-text"></i> متابعة</button>
          <button onclick="printClientStatement('${c.id}')" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-printer"></i> كشف حساب</button>
          <button onclick="editClient('${c.id}')" class="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-note-pencil"></i> تعديل</button>
          <button onclick="deleteClient('${c.id}')" class="p-1 text-rose-500 hover:bg-rose-50 rounded-md text-xs transition-all"><i class="ph ph-trash"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// بيحسب رصيد عقد واحد: كام اتحصّل (شامل المقدم) وكام متبقي وعدد الأقساط المسددة
function computeContractBalance(contract) {
  const contractInsts = db.installments.filter(i => i.contractId === contract.id);
  const paidInsts = contractInsts.filter(i => i.status === 'paid');
  const paidFromInstallments = paidInsts.reduce((sum, i) => sum + safeNum(i.paidAmount || i.amount), 0);
  // أي أقساط لسه "pending" لكن عليها سداد جزئي متسجل، برضه بتحسب في المسدد
  const partialFromPending = contractInsts
    .filter(i => i.status !== 'paid')
    .reduce((sum, i) => sum + safeNum(i.paidAmount), 0);
  const totalPaid = (contract.downPayment || 0) + paidFromInstallments + partialFromPending;
  const totalRemaining = Math.max(0, (contract.totalValue || 0) - totalPaid);

  return {
    totalValue: contract.totalValue || 0,
    totalPaid,
    totalRemaining,
    installmentsPaid: paidInsts.length,
    installmentsTotal: contractInsts.length
  };
}

// بيحسب رصيد العميل الكامل مجمّع من كل عقوده (كل الأجهزة اللي واخدها)
// بيفحص سجل العميل الكامل (كل عقوده وكل أقساطه) ويحدد هل عنده سوابق تأخير
// عن الميعاد (بعد فترة السماح المحددة في كل عقد) — سواء أقساط اتسددت
// متأخرة، أو أقساط لسه متأخرة دلوقتي. بنستخدمها كتحذير وقت عمل عقد جديد.
function getClientRiskInfo(clientId) {
  const clientContracts = db.contracts.filter(c => c.clientId === clientId);
  if (clientContracts.length === 0) return null;
  const contractIds = new Set(clientContracts.map(c => c.id));
  const allInsts = db.installments.filter(i => contractIds.has(i.contractId));

  let lateCount = 0;
  allInsts.forEach(inst => {
    const contract = clientContracts.find(c => c.id === inst.contractId);
    if (!contract) return;
    const graceDays = contract.graceDays || 0;
    if (inst.status === 'paid') {
      if (inst.paidDate && inst.dueDate) {
        const diffDays = Math.floor((new Date(inst.paidDate) - new Date(inst.dueDate)) / (1000 * 60 * 60 * 24));
        if (diffDays > graceDays) lateCount++;
      }
    } else {
      const stats = getInstallmentOverdueStatus(inst);
      if (stats.overdueDays > graceDays) lateCount++;
    }
  });

  if (lateCount >= 3) return { level: 'high', label: `⚠️ عميل عالي المخاطر (${lateCount} حالة تأخير)`, badgeClass: 'badge-danger' };
  if (lateCount >= 1) return { level: 'medium', label: `له سوابق تأخير (${lateCount} ${lateCount === 1 ? 'مرة' : 'مرات'})`, badgeClass: 'badge-warning' };
  return { level: 'none', label: 'عميل ملتزم بالمواعيد', badgeClass: 'badge-success' };
}

window.checkClientRiskWarning = function() {
  const clientId = document.getElementById('contract-client-select').value;
  const warningEl = document.getElementById('contract-client-risk-warning');
  if (!clientId) { warningEl.classList.add('hidden'); return; }

  const risk = getClientRiskInfo(clientId);
  if (!risk || risk.level === 'none') { warningEl.classList.add('hidden'); return; }

  const colors = {
    high: 'bg-rose-50 text-rose-700 border border-rose-200',
    medium: 'bg-amber-50 text-amber-700 border border-amber-200'
  };
  warningEl.className = `mt-2 p-2 rounded-lg text-xs font-semibold ${colors[risk.level]}`;
  warningEl.textContent = risk.label;
  warningEl.classList.remove('hidden');
};

function computeClientBalance(clientId) {
  const clientContracts = db.contracts.filter(c => c.clientId === clientId);
  const devices = clientContracts.map(c => ({ contract: c, balance: computeContractBalance(c) }));

  const totals = devices.reduce((acc, d) => {
    acc.totalValue += d.balance.totalValue;
    acc.totalPaid += d.balance.totalPaid;
    acc.totalRemaining += d.balance.totalRemaining;
    return acc;
  }, { totalValue: 0, totalPaid: 0, totalRemaining: 0 });

  return { devices, totals };
}

let expandedBalanceClients = new Set();
window.toggleClientBalanceRow = function(clientId) {
  if (expandedBalanceClients.has(clientId)) {
    expandedBalanceClients.delete(clientId);
  } else {
    expandedBalanceClients.add(clientId);
  }
  renderClientBalances();
};

function renderClientBalances() {
  const searchVal = (document.getElementById('balance-search-input').value || '').toLowerCase();
  const listContainer = document.getElementById('client-balances-list');
  const emptyState = document.getElementById('balances-empty-state');
  // FIX: نفس الحماية العامة ضد 'innerHTML of null'
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const clientsWithContracts = db.clients.filter(c => db.contracts.some(ct => ct.clientId === c.id));
  const filtered = clientsWithContracts.filter(c =>
    (c.name || '').toLowerCase().includes(searchVal) || (c.phone || '').includes(searchVal)
  );

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    document.getElementById('balance-summary-total').textContent = '0';
    document.getElementById('balance-summary-paid').textContent = '0';
    document.getElementById('balance-summary-remaining').textContent = '0';
    renderPaginationControls('client-balances', 1, 1, 0, 'client-balances-list', renderClientBalances);
    return;
  }
  emptyState.classList.add('hidden');

  // IMPROVEMENT #1 (الأداء): الإجماليات (فوق الصفحة) بتتحسب على كل العملاء
  // المفلترين زي ما هو، لكن رسم البطاقات نفسها بيتقسم لصفحات (25 عميل).
  let grandTotal = 0, grandPaid = 0, grandRemaining = 0;
  filtered.forEach(client => {
    const totals = computeClientBalance(client.id).totals;
    grandTotal += totals.totalValue;
    grandPaid += totals.totalPaid;
    grandRemaining += totals.totalRemaining;
  });

  const pageItems = paginate('client-balances', filtered, 'client-balances-list', renderClientBalances);

  pageItems.forEach(client => {
    const { devices, totals } = computeClientBalance(client.id);

    const progressPct = totals.totalValue > 0 ? Math.round((totals.totalPaid / totals.totalValue) * 100) : 0;
    const isExpanded = expandedBalanceClients.has(client.id);

    const card = document.createElement('div');
    card.className = 'glass-card rounded-2xl overflow-hidden';
    card.innerHTML = `
      <div onclick="toggleClientBalanceRow('${client.id}')" class="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors select-none">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-sm">
            <i class="ph ${isExpanded ? 'ph-folder-open' : 'ph-folder'} text-lg"></i>
          </div>
          <div>
            <h4 class="font-bold text-slate-800 text-md">${escapeHTML(client.name)}</h4>
            <p class="text-xs text-slate-400 font-mono mt-0.5">هاتف: ${escapeHTML(client.phone)} | عدد الأجهزة: ${devices.length}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-4 text-xs font-semibold">
          <div class="bg-slate-100 text-slate-700 py-1.5 px-3 rounded-lg">إجمالي: <span class="font-black text-sm">${totals.totalValue.toLocaleString()} ج.م</span></div>
          <div class="bg-emerald-50 text-emerald-700 py-1.5 px-3 rounded-lg">تم تحصيله: <span class="font-black text-sm">${totals.totalPaid.toLocaleString()} ج.م</span></div>
          <div class="bg-amber-50 text-amber-700 py-1.5 px-3 rounded-lg">المتبقي: <span class="font-black text-sm">${totals.totalRemaining.toLocaleString()} ج.م</span></div>
          <div class="w-24 hidden sm:block">
            <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div class="h-full bg-emerald-500" style="width:${progressPct}%"></div>
            </div>
            <p class="text-[10px] text-slate-400 mt-0.5 text-center">${progressPct}% مسدد</p>
          </div>
          <i class="ph ${isExpanded ? 'ph-caret-up' : 'ph-caret-down'} text-slate-400 text-sm ml-2"></i>
        </div>
      </div>

      <div class="${isExpanded ? '' : 'hidden'} border-t border-slate-100 p-4 space-y-2">
        <div class="overflow-x-auto">
          <table class="w-full text-right border-collapse text-xs">
            <thead>
              <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                <th class="p-2.5">الجهاز</th>
                <th class="p-2.5">رقم العقد</th>
                <th class="p-2.5">قيمة العقد</th>
                <th class="p-2.5">تم تحصيله</th>
                <th class="p-2.5">المتبقي</th>
                <th class="p-2.5">الأقساط المنجزة</th>
                <th class="p-2.5 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              ${devices.map(d => `
                <tr>
                  <td class="p-2.5 font-bold">${escapeHTML(d.contract.deviceInfo)}</td>
                  <td class="p-2.5 font-mono text-slate-500">${escapeHTML(d.contract.id.replace('con-', ''))}</td>
                  <td class="p-2.5 font-mono font-bold">${d.balance.totalValue.toLocaleString()} ج.م</td>
                  <td class="p-2.5 font-mono text-emerald-600 font-bold">${d.balance.totalPaid.toLocaleString()} ج.م</td>
                  <td class="p-2.5 font-mono text-amber-600 font-bold">${d.balance.totalRemaining.toLocaleString()} ج.م</td>
                  <td class="p-2.5 font-mono">${d.balance.installmentsPaid} / ${d.balance.installmentsTotal}</td>
                  <td class="p-2.5 text-center">
                    <button onclick="viewContractDetails('${d.contract.id}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[10px] font-semibold transition-all">تفاصيل العقد</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    listContainer.appendChild(card);
  });

  document.getElementById('balance-summary-total').textContent = grandTotal.toLocaleString();
  document.getElementById('balance-summary-paid').textContent = grandPaid.toLocaleString();
  document.getElementById('balance-summary-remaining').textContent = grandRemaining.toLocaleString();
}

document.getElementById('balance-search-input').addEventListener('input', debouncedSearch('client-balances', renderClientBalances));

// --- 3. INVENTORY & DEVICES ---

// عدد الأيام بين تاريخ نصي (YYYY-MM-DD) واليوم الحالي، بيستخدم في تقرير "عمر المخزون"
function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return null;
  const diffMs = Date.now() - then.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

// يبني (أو يعيد استخدام) عناصر فلاتر الفرع/المورد/الحالة فوق جدول المخزون بشكل ديناميكي
function populateInventoryFilters() {
  const branchSel = document.getElementById('inventory-filter-branch');
  const supplierSel = document.getElementById('inventory-filter-supplier');
  if (!branchSel || !supplierSel) return;

  const branches = [...new Set(db.inventory.map(d => d.branch || 'الفرع الرئيسي'))].sort();
  const currentBranch = branchSel.value;
  branchSel.innerHTML = '<option value="">كل الفروع</option>' + branches.map(b => `<option value="${escapeHTML(b)}">${escapeHTML(b)}</option>`).join('');
  if (branches.includes(currentBranch)) branchSel.value = currentBranch;

  const suppliers = [...new Set(db.inventory.map(d => d.supplier).filter(Boolean))].sort();
  const currentSupplier = supplierSel.value;
  supplierSel.innerHTML = '<option value="">كل الموردين</option>' + suppliers.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');
  if (suppliers.includes(currentSupplier)) supplierSel.value = currentSupplier;
}

function renderInventory() {
  const searchVal = document.getElementById('inventory-search').value.toLowerCase();
  const tbody = document.getElementById('inventory-table-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  const emptyState = document.getElementById('inventory-empty-state');

  const statusFilterEl = document.getElementById('inventory-filter-status');
  const branchFilterEl = document.getElementById('inventory-filter-branch');
  const supplierFilterEl = document.getElementById('inventory-filter-supplier');
  const lowStockOnlyEl = document.getElementById('inventory-filter-lowstock');

  const statusFilter = statusFilterEl ? statusFilterEl.value : '';
  const branchFilter = branchFilterEl ? branchFilterEl.value : '';
  const supplierFilter = supplierFilterEl ? supplierFilterEl.value : '';
  const lowStockOnly = lowStockOnlyEl ? lowStockOnlyEl.checked : false;

  tbody.innerHTML = '';

  populateInventoryFilters();

  document.getElementById('inv-suppliers-count').textContent = db.suppliers.length;
  document.getElementById('inv-total-count').textContent = [...new Set(db.inventory.map(d => `${d.brand}_${d.name}`))].length;
  document.getElementById('inv-available-count').textContent = db.inventory.filter(d => d.status === 'available').length;
  document.getElementById('inv-sold-count').textContent = db.inventory.filter(d => d.status.startsWith('sold')).length;

  const invValueEl = document.getElementById('inv-value-count');
  if (invValueEl) {
    if (isAdmin()) {
      const totalValue = db.inventory.filter(d => d.status === 'available' || d.status === 'maintenance').reduce((s, d) => s + safeNum(d.costPrice), 0);
      invValueEl.textContent = `${totalValue.toLocaleString()} ج.م`;
    } else {
      invValueEl.innerHTML = '<i class="ph ph-lock-key"></i>';
    }
  }
  const maintenanceCountEl = document.getElementById('inv-maintenance-count');
  if (maintenanceCountEl) {
    maintenanceCountEl.textContent = db.inventory.filter(d => d.status === 'maintenance').length;
  }

  const grouped = {};
  db.inventory.forEach(dev => {
    const branch = dev.branch || 'الفرع الرئيسي';
    const key = `${dev.brand}_${dev.name}_${dev.costPrice}_${dev.sellingPrice}_${dev.supplier}_${branch}`;
    if (!grouped[key]) {
      grouped[key] = {
        brand: dev.brand,
        name: dev.name,
        costPrice: dev.costPrice,
        sellingPrice: dev.sellingPrice,
        supplier: dev.supplier,
        branch,
        minQty: dev.minQty || 3,
        devices: []
      };
    }
    grouped[key].devices.push(dev);
  });

  let groupedList = Object.values(grouped).filter(group => {
    return (group.name || '').toLowerCase().includes(searchVal) || (group.brand || '').toLowerCase().includes(searchVal);
  });

  if (statusFilter) {
    groupedList = groupedList.filter(g => g.devices.some(d => statusFilter === 'sold' ? d.status.startsWith('sold') : d.status === statusFilter));
  }
  if (branchFilter) {
    groupedList = groupedList.filter(g => g.branch === branchFilter);
  }
  if (supplierFilter) {
    groupedList = groupedList.filter(g => g.supplier === supplierFilter);
  }

  let lowStockGroupsCount = 0;
  groupedList.forEach(g => {
    const avail = g.devices.filter(d => d.status === 'available').length;
    if (avail > 0 && avail <= (g.minQty || 3)) lowStockGroupsCount++;
  });
  const lowStockEl = document.getElementById('inv-lowstock-count');
  if (lowStockEl) lowStockEl.textContent = lowStockGroupsCount;

  if (lowStockOnly) {
    groupedList = groupedList.filter(g => {
      const avail = g.devices.filter(d => d.status === 'available').length;
      return avail > 0 && avail <= (g.minQty || 3);
    });
  }

  renderBestSellers();

  if (groupedList.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const userIsAdmin = isAdmin();

  groupedList.forEach(group => {
    const totalQty = group.devices.length;
    const availDevices = group.devices.filter(d => d.status === 'available');
    const availQty = availDevices.length;
    const minQty = group.minQty || 3;
    const isLowStock = availQty > 0 && availQty <= minQty;
    const isOutOfStock = availQty === 0 && totalQty > 0;

    // أقدم قطعة متاحة بالمخزن لحساب "عمر المخزون" (كام يوم واقفة من غير ما تتباع)
    const oldestAge = availDevices.reduce((max, d) => {
      const age = daysSince(d.addedDate);
      return age !== null && age > max ? age : max;
    }, 0);

    // FEATURE: زرار "مرتجع" سريع جنب كل قطعة متاحة مباشرة (بدل ما يكون
    // مخبّى جوه نافذة تفاصيل القطعة)، عشان لو اشتريت 5 قطع أو أكتر من مورد
    // وعايز ترجّع وحدة منهم بسرعة، مش محتاج تفتح النافذة الأول. الزرار
    // بينادي بالظبط نفس دالة returnDeviceToSupplier اللي بتخصم من المخزون
    // ومن رصيد المورد مع بعض بشكل صحيح ومترابط.
    const serialBadges = group.devices.map(d => {
      let bg = 'bg-slate-100 text-slate-600';
      let title = 'متاح';
      if (d.status === 'sold_installment') {
        bg = 'bg-teal-50 text-teal-700 border border-teal-100';
        title = `قسط لـ: ${d.soldTo}`;
      } else if (d.status === 'sold_cash') {
        bg = 'bg-amber-50 text-amber-700 border border-amber-100';
        title = `كاش لـ: ${d.soldTo}`;
      } else if (d.status === 'maintenance') {
        bg = 'bg-purple-50 text-purple-700 border border-purple-100';
        title = 'تحت الصيانة';
      }
      const returnBtn = (d.status === 'available' && userIsAdmin)
        ? `<button onclick="event.stopPropagation(); returnDeviceToSupplier('${d.id}')" title="إرجاع هذه القطعة للمورد" class="inline-flex items-center justify-center w-4 h-4 -mr-1 align-middle text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-full"><i class="ph ph-arrow-u-up-left text-[10px]"></i></button>`
        : '';
      return `<span class="inline-flex items-center m-0.5">${returnBtn}<span onclick="openDeviceActionsModal('${d.id}')" class="inline-block cursor-pointer text-[10px] font-mono px-1.5 py-0.5 rounded ${bg} hover:ring-1 hover:ring-slate-300" title="${escapeHTML(title)} — اضغط لعرض تفاصيل القطعة">${escapeHTML(d.serial)}</span></span>`;
    }).join(' ');

    const stockBadge = isOutOfStock
      ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-100 text-rose-700 text-xs font-bold">نفذت الكمية</span>`
      : isLowStock
        ? `<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-amber-100 text-amber-700 text-xs font-bold" title="الحد الأدنى: ${minQty}"><i class="ph ph-warning"></i> ${availQty} متاح / ${totalQty} كلي (منخفض)</span>`
        : `<span class="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-100 text-slate-800 text-xs font-bold">${availQty} متاح / ${totalQty} كلي</span>`;

    const costCell = userIsAdmin
      ? `${group.costPrice.toLocaleString()} ج.م`
      : `<span class="text-slate-300" title="مخفي - للأدمن فقط"><i class="ph ph-lock-key"></i></span>`;

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-colors';
    tr.innerHTML = `
      <td class="p-4 font-bold text-slate-800">${escapeHTML(group.brand)}</td>
      <td class="p-4">${escapeHTML(group.name)}</td>
      <td class="p-4 text-slate-500 text-xs">${escapeHTML(group.branch)}</td>
      <td class="p-4 text-slate-600 text-xs">${escapeHTML(group.supplier) || '-'}</td>
      <td class="p-4 font-bold font-mono text-emerald-600">${costCell}</td>
      <td class="p-4 font-bold font-mono text-teal-600">${group.sellingPrice.toLocaleString()} ج.م</td>
      <td class="p-4">${stockBadge}</td>
      <td class="p-4 text-xs text-slate-500">${availQty > 0 ? (oldestAge + ' يوم') : '—'}</td>
      <td class="p-4 max-w-xs overflow-hidden">${serialBadges}</td>
      <td class="p-4 text-center">
        <div class="inline-flex gap-1.5">
          ${availQty > 0 ? `
            <button data-brand="${escapeHTML(group.brand)}" data-name="${escapeHTML(group.name)}" onclick="openCashSaleModalGrouped(this.dataset.brand, this.dataset.name)" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold shadow-sm transition-all flex items-center gap-1">
              <i class="ph ph-money"></i> بيع كاش
            </button>
          ` : `<span class="text-xs text-slate-400 font-semibold">لا يوجد متاح</span>`}
          <button data-brand="${escapeHTML(group.brand)}" data-name="${escapeHTML(group.name)}" onclick="editDeviceGroup(this.dataset.brand, this.dataset.name)" class="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-note-pencil"></i> تعديل</button>
          <button data-brand="${escapeHTML(group.brand)}" data-name="${escapeHTML(group.name)}" onclick="deleteDeviceGroup(this.dataset.brand, this.dataset.name)" class="p-1 text-rose-500 hover:bg-rose-50 rounded transition-colors"><i class="ph ph-trash"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// لوحة "الأكثر مبيعاً": بتحسب عدد القطع المباعة (كاش أو قسط) لكل صنف/موديل
// عبر كل تاريخ المخزون، وتعرض أعلى 5 أصناف مبيعاً.
function renderBestSellers() {
  const container = document.getElementById('inv-best-sellers');
  if (!container) return;

  const soldCounts = {};
  db.inventory.forEach(d => {
    if (!d.status.startsWith('sold')) return;
    const key = `${d.brand} ${d.name}`;
    soldCounts[key] = (soldCounts[key] || 0) + 1;
  });

  const top = Object.entries(soldCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (top.length === 0) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  container.innerHTML = `
    <p class="text-xs font-bold text-slate-500 mb-2 flex items-center gap-1.5"><i class="ph ph-trend-up"></i> الأكثر مبيعاً</p>
    <div class="flex flex-wrap gap-2">
      ${top.map(([name, count], idx) => `
        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100 text-xs font-semibold text-slate-700">
          <span class="text-teal-600 font-bold">#${idx + 1}</span> ${escapeHTML(name)}
          <span class="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 text-[10px] font-bold">${count} مباع</span>
        </span>
      `).join('')}
    </div>
  `;
}

// Cash Sale Modal for grouped items
window.openCashSaleModalGrouped = function(brand, name) {
  const availableDevices = db.inventory.filter(d => d.brand === brand && d.name === name && d.status === 'available');
  if (availableDevices.length === 0) return;

  const infoEl = document.getElementById('cash-sale-device-info');
  infoEl.innerHTML = `
    <div class="space-y-2">
      <p>الجهاز: <strong>${escapeHTML(brand)} ${escapeHTML(name)}</strong></p>
      <div>
        <label class="form-label text-xs">اختر الرقم التسلسلي (سيريال) المراد بيعه:</label>
        <select id="cash-sale-serial-select" class="form-input text-xs py-1">
          ${availableDevices.map(d => `<option value="${d.id}">${escapeHTML(d.serial)}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  document.getElementById('cash-sale-brand-model').value = `${brand} ${name}`;
  document.getElementById('cash-sale-price').value = availableDevices[0].sellingPrice;
  openModal('cash-sale-modal');
};

window.deleteDeviceGroup = async function(brand, name) {
  await runWithActionLock(`delete-device-group-${brand}-${name}`, async () => {
  if (!isAdmin()) {
    alert('⛔ حذف المخزون مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  
  const devicesToDelete = db.inventory.filter(d => d.brand === brand && d.name === name && d.status === 'available');
  if (devicesToDelete.length === 0) return;

  if (await customConfirm(`⚠️ هل أنت متأكد من حذف عدد ${devicesToDelete.length} قطعة متاحة من (${brand} ${name})؟\n\nسيتم إرجاع مبالغ الشراء "الكاش" للخزينة تلقائياً، وتصحيح رصيد الموردين المرتبطين بالقطع دي تلقائياً كمان.`)) {
    let refundedAmount = 0;
    let refundedCount = 0;
    // FIX: زي بالظبط مشكلة "إرجاع للمورد" اللي اتصلحت قبل كده - حذف جهاز من
    // هنا كان بيمسحه من المخزون بس من غير ما يلمس سجل المورد (supplierTransactions)
    // خالص. لو الجهاز كان مشترى بالآجل، كانت الشركة تفضل "مديونة" للمورد
    // بقيمة جهاز اتمسح ومبقاش موجود أصلاً. ولو كان كاش، الخزينة كانت بترجع
    // صح، لكن "إجمالي المشتريات" المعروض للمورد كان يفضل مبالغ فيه. دلوقتي
    // بنسجل حركة "مرتجع" في سجل كل مورد مرتبط بالقطع المحذوفة دي بنفس نوع
    // الشراء الأصلي بالظبط.
    const supplierReturnsBySupplier = {};

    devicesToDelete.forEach(dev => {
      // لو القطعة مشتراة كاش، نرجع تمنها للخزينة
      if (dev.purchaseMethod === 'cash') {
        refundedAmount += parseFloat(dev.costPrice || 0);
        refundedCount++;
        
        const refundTx = {
          id: `tr-rev-inv-${Date.now()}-${refundedCount}`,
          type: 'in',
          amount: parseFloat(dev.costPrice),
          category: 'استرداد مشتريات مخزون',
          method: 'cash',
          details: `استرداد قيمة جهاز محذوف: ${dev.brand} ${dev.name} (SN: ${dev.serial})`,
          user: currentUser ? currentUser.name : 'مجهول',
          timestamp: nowTimestamp()
        };
        db.treasuryTransactions.push(refundTx);
        syncWithAppsScript('addTreasuryTransaction', refundTx);
      }

      // تصحيح سجل المورد (بغض النظر عن كاش أو آجل)
      const originalPurchaseTx = db.supplierTransactions.find(t => t.relatedDeviceId === dev.id && t.type === 'purchase');
      // FIX (توافق مع بيانات قديمة): أجهزة اتضافت قبل إصلاح الاستيراد
      // الجماعي مفيهاش supplierId خالص - بنحاول كحل أخير نلاقي المورد
      // بمطابقة الاسم النصي المخزَّن على الجهاز.
      const supplierId = originalPurchaseTx ? originalPurchaseTx.supplierId : (dev.supplierId || (db.suppliers.find(s => s.name === dev.supplier) || {}).id);
      const method = originalPurchaseTx ? originalPurchaseTx.method : (dev.purchaseMethod || 'credit');
      const supplierName = originalPurchaseTx ? originalPurchaseTx.supplierName : dev.supplier;
      if (supplierId) {
        const returnTx = {
          id: `sptx-ret-${Date.now()}-${dev.id}`,
          supplierId,
          supplierName,
          type: 'return',
          method,
          amount: safeNum(dev.costPrice),
          timestamp: nowTimestamp(),
          date: nowTimestamp().split(' ')[0],
          notes: `مرتجع تلقائي بسبب حذف الجهاز من المخزون: ${dev.brand} ${dev.name} (SN: ${dev.serial})`,
          relatedDeviceId: dev.id
        };
        db.supplierTransactions.unshift(returnTx);
        if (!supplierReturnsBySupplier[supplierId]) supplierReturnsBySupplier[supplierId] = [];
        supplierReturnsBySupplier[supplierId].push(returnTx);
      }
    });

    for (const supId of Object.keys(supplierReturnsBySupplier)) {
      for (const returnTx of supplierReturnsBySupplier[supId]) {
        await syncWithAppsScript('addSupplierTransaction', { transaction: returnTx });
      }
    }

    db.inventory = db.inventory.filter(d => !devicesToDelete.some(td => td.id === d.id));
    
    logAction('حذف كمية أجهزة', `حذف ${devicesToDelete.length} قطعة من ${brand} ${name} وإرجاع ${refundedAmount} ج.م للخزينة وتصحيح أرصدة الموردين المرتبطين`);
    
    await syncWithAppsScript('deleteDeviceGroup', { brand, name });
    
    renderInventory();
    renderTreasury();
    renderSuppliers();
    renderDashboard();
    showToast(`✅ تم حذف الأجهزة، إرجاع ${refundedAmount} ج.م للخزينة، وتصحيح أرصدة الموردين`, 'success');
  }
  });
};

window.editDeviceGroup = function(brand, name) {
  if (!isAdmin()) {
    alert('⛔ تعديل المخزون مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  const sampleDev = db.inventory.find(d => d.brand === brand && d.name === name);
  if (!sampleDev) return;

  document.getElementById('edit-inv-brand').value = brand;
  document.getElementById('edit-inv-name').value = name;
  document.getElementById('edit-inv-cost').value = sampleDev.costPrice;
  document.getElementById('edit-inv-price').value = sampleDev.sellingPrice;
  document.getElementById('edit-inv-supplier').value = sampleDev.supplier || '';
  document.getElementById('edit-inv-minqty').value = sampleDev.minQty || 3;
  openModal('edit-inventory-modal');
};

window.saveInventoryEdit = async function() {
  await runWithActionLock("save-inventory-edit", async () => {
  if (!isAdmin()) return;
  const brand = document.getElementById('edit-inv-brand').value;
  const name = document.getElementById('edit-inv-name').value;
  const newCost = parseFloat(document.getElementById('edit-inv-cost').value) || 0;
  const newPrice = parseFloat(document.getElementById('edit-inv-price').value) || 0;
  const newSupplier = document.getElementById('edit-inv-supplier').value.trim();
  const newMinQty = parseInt(document.getElementById('edit-inv-minqty').value) || 3;

  db.inventory.forEach(d => {
    if (d.brand === brand && d.name === name) {
      d.costPrice = newCost;
      d.sellingPrice = newPrice;
      d.supplier = newSupplier;
      d.minQty = newMinQty;
    }
  });

  logAction('تعديل مخزون', `تعديل أسعار صنف ${brand} ${name}: تكلفة ${newCost} ج.م، بيع ${newPrice} ج.م، حد أدنى ${newMinQty}`);
  
  await syncWithAppsScript('updateDeviceGroup', { brand, name, costPrice: newCost, sellingPrice: newPrice, supplier: newSupplier, minQty: newMinQty });
  
  closeModal('edit-inventory-modal');
  renderInventory();
  renderDashboard();
  });
};

// ================= DEVICE ACTIONS: تفاصيل القطعة، الصيانة، الإرجاع، الطباعة =================

const DEVICE_STATUS_LABELS = {
  available: 'متاح بالمخزن',
  sold_cash: 'مباع كاش',
  sold_installment: 'مباع بالتقسيط',
  maintenance: 'تحت الصيانة'
};
const DEVICE_CONDITION_LABELS = {
  new: 'جديد',
  used: 'مستعمل',
  refurbished: 'مجدد (Refurbished)'
};

window.openDeviceActionsModal = function(deviceId) {
  const dev = db.inventory.find(d => d.id === deviceId);
  if (!dev) return;

  document.getElementById('device-actions-title').textContent = `${dev.brand} ${dev.name} — ${dev.serial}`;

  const warrantyInfo = dev.warrantyMonths
    ? `${dev.warrantyMonths} شهر${dev.addedDate ? ' (حتى ' + computeWarrantyExpiry(dev) + ')' : ''}`
    : 'بدون ضمان مسجل';

  const infoHtml = `
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div><span class="text-slate-400">الحالة:</span> <strong>${DEVICE_STATUS_LABELS[dev.status] || dev.status}</strong></div>
      <div><span class="text-slate-400">حالة القطعة:</span> <strong>${DEVICE_CONDITION_LABELS[dev.condition] || '-'}</strong></div>
      <div><span class="text-slate-400">الفرع:</span> <strong>${escapeHTML(dev.branch || '-')}</strong></div>
      <div><span class="text-slate-400">المورد:</span> <strong>${escapeHTML(dev.supplier || '-')}</strong></div>
      <div><span class="text-slate-400">الضمان:</span> <strong>${warrantyInfo}</strong></div>
      <div><span class="text-slate-400">تاريخ الإضافة:</span> <strong>${escapeHTML(dev.addedDate || '-')}</strong></div>
      ${dev.soldTo ? `<div class="col-span-2"><span class="text-slate-400">بيع لـ:</span> <strong>${escapeHTML(dev.soldTo)}</strong></div>` : ''}
      ${dev.notes ? `<div class="col-span-2"><span class="text-slate-400">ملاحظات:</span> ${escapeHTML(dev.notes)}</div>` : ''}
    </div>
  `;
  document.getElementById('device-actions-info').innerHTML = infoHtml;

  // أزرار الإجراءات حسب حالة القطعة الحالية
  const actionsEl = document.getElementById('device-actions-buttons');
  let buttons = '';
  if (dev.status === 'available') {
    buttons += `<button onclick="sendDeviceToMaintenance('${dev.id}')" class="px-3 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"><i class="ph ph-wrench"></i> إرسال للصيانة</button>`;
    if (isAdmin()) {
      buttons += `<button onclick="returnDeviceToSupplier('${dev.id}')" class="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"><i class="ph ph-arrow-u-up-left"></i> إرجاع للمورد (تالف)</button>`;
    }
  } else if (dev.status === 'maintenance') {
    buttons += `<button onclick="returnDeviceFromMaintenance('${dev.id}')" class="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"><i class="ph ph-check-circle"></i> إرجاع للمتاح بعد الصيانة</button>`;
  } else if (dev.status === 'sold_cash' || dev.status === 'sold_installment') {
    if (isAdmin()) {
      buttons += `<button onclick="returnDeviceToStockFromClient('${dev.id}')" class="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"><i class="ph ph-arrow-u-up-left"></i> استرجاع من العميل للمخزن</button>`;
    }
  }
  buttons += `<button onclick="printDeviceLabel('${dev.id}')" class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"><i class="ph ph-printer"></i> طباعة ملصق</button>`;
  actionsEl.innerHTML = buttons;

  // سجل تاريخ الحركة
  const historyEl = document.getElementById('device-actions-history');
  const history = dev.history || [];
  historyEl.innerHTML = history.length > 0
    ? history.map(h => `<div class="text-[11px] text-slate-500 border-r-2 border-slate-100 pr-2 py-1"><strong class="text-slate-700">${escapeHTML(h.action)}</strong> — ${escapeHTML(h.date)} <span class="text-slate-400">(${escapeHTML(h.by)})</span>${h.note ? '<br>' + escapeHTML(h.note) : ''}</div>`).join('')
    : '<p class="text-xs text-slate-400">لا يوجد سجل حركة مسجل لهذه القطعة.</p>';

  openModal('device-actions-modal');
};

function computeWarrantyExpiry(dev) {
  if (!dev.addedDate || !dev.warrantyMonths) return '-';
  const d = new Date(dev.addedDate);
  d.setMonth(d.getMonth() + parseInt(dev.warrantyMonths));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

window.sendDeviceToMaintenance = async function(deviceId) {
  const dev = db.inventory.find(d => d.id === deviceId);
  if (!dev || dev.status !== 'available') return;
  const reason = (await customPrompt('سبب إرسال القطعة للصيانة (اختياري):', '', 'إرسال قطعة للصيانة')) || '';

  dev.status = 'maintenance';
  addDeviceHistory(dev, 'إرسال للصيانة', reason);
  logAction('إرسال جهاز للصيانة', `${dev.brand} ${dev.name} (SN: ${dev.serial}) — ${reason}`);
  await syncWithAppsScript('updateDevice', { id: dev.id, status: dev.status, history: dev.history });

  closeModal('device-actions-modal');
  renderInventory();
  renderDashboard();
};

window.returnDeviceFromMaintenance = async function(deviceId) {
  const dev = db.inventory.find(d => d.id === deviceId);
  if (!dev || dev.status !== 'maintenance') return;

  dev.status = 'available';
  addDeviceHistory(dev, 'إرجاع من الصيانة', 'تم الانتهاء من الصيانة وإرجاع القطعة للمتاح');
  logAction('إرجاع جهاز من الصيانة', `${dev.brand} ${dev.name} (SN: ${dev.serial})`);
  await syncWithAppsScript('updateDevice', { id: dev.id, status: dev.status, history: dev.history });

  closeModal('device-actions-modal');
  renderInventory();
  renderDashboard();
};

// إرجاع قطعة "مباعة" (كاش أو قسط) للمخزن كمرتجع من العميل. ملحوظة هامة:
// الإجراء ده بيرجع حالة القطعة لمتاح بس مش بيعدّل تلقائياً أي عقد أو حركة
// خزينة مرتبطة بالبيع الأصلي (لتفادي كسر أرصدة العملاء) — أي تسوية مالية
// لازم تتم يدوياً من شاشة العقود/الخزينة حسب حالة كل عميل.
window.returnDeviceToStockFromClient = async function(deviceId) {
  const dev = db.inventory.find(d => d.id === deviceId);
  if (!dev || !dev.status.startsWith('sold')) return;
  if (!isAdmin()) {
    alert('⛔ استرجاع القطع من العملاء مخصص للمشرف (ADMIN) فقط.');
    return;
  }

  // FIX: كان الزرار ده بيرجّع الجهاز للمخزون من غير ما يلمس العقد أو
  // الأقساط أو الخزينة خالص، وساب العقد "يتيم" لسه شغال في التحصيلات
  // والتقارير وكأن العميل لسه عليه أقساط لجهاز مش عنده أصلاً. دلوقتي لو
  // الجهاز ده مباع بالتقسيط وله عقد نشط، بنستخدم بالظبط نفس المسار الصحيح
  // الموجود في تبويب العقود (استرجاع الجهاز - تعثر) اللي بيقفل العقد صح
  // ويلغي الأقساط المتبقية ويحتفظ بالمحصّل فعلاً. الجهاز المباع كاش (مفيش
  // عقد له أصلاً) لسه بيمشي بالمسار البسيط القديم زي ما هو.
  const linkedContract = db.contracts.find(c => c.deviceId === deviceId && c.status !== 'defaulted' && c.status !== 'settled_early' && c.status !== 'upgraded');
  if (linkedContract) {
    closeModal('device-actions-modal');
    window.openRepossessModal(linkedContract.id);
    return;
  }

  const confirmed = await customConfirm(
    `هل أنت متأكد من استرجاع هذه القطعة (${dev.brand} ${dev.name}) للمخزن؟\nملحوظة: هذا الإجراء لن يعدّل تلقائياً أي عقد أو رصيد خزينة مرتبط — يجب مراجعة وتسوية العقد/التحصيلات يدوياً بعدها.`,
    'استرجاع من العميل'
  );
  if (!confirmed) return;

  const reason = (await customPrompt('سبب الاسترجاع:', '', 'استرجاع قطعة من العميل')) || '';
  const previousOwner = dev.soldTo;
  dev.status = 'available';
  dev.soldTo = '';
  addDeviceHistory(dev, 'استرجاع من العميل', `تم استرجاع القطعة من (${previousOwner}). السبب: ${reason}`);
  logAction('استرجاع جهاز من عميل', `${dev.brand} ${dev.name} (SN: ${dev.serial}) من ${previousOwner} — ${reason}`);
  await syncWithAppsScript('updateDevice', { id: dev.id, status: dev.status, soldTo: dev.soldTo, history: dev.history });

  closeModal('device-actions-modal');
  renderInventory();
  renderDashboard();
};

// إرجاع قطعة تالفة للمورد نهائياً: بتتحذف من المخزون، ويتسجل مبلغ استرداد
// (Refund) في الخزينة لو المورد رد فلوس القطعة نقداً.
// FIX: قبل كده كانت الدالة دي بتحذف الجهاز من المخزون بس، وميظهرش أي أثر
// خالص في رصيد المورد (computeSupplierBalance) - لأن ده بيعتمد بالكامل على
// سجل db.supplierTransactions المنفصل عن المخزون. يعني لو الجهاز كان
// مشترى بالآجل ولسه ما اتدفعش، وترجّعه للمورد كعيب مصنعي، كانت الشركة
// تفضل "مديونة" للمورد بقيمة جهاز مبقاش موجود ولا هيتباع أصلاً. دلوقتي
// بنسجّل حركة "مرتجع" رسمية في سجل المورد نفسه (مربوطة بنفس نوع الشراء
// الأصلي: آجل أو كاش) عشان الرصيد يتصحح صح في كل تقارير الموردين.
window.returnDeviceToSupplier = async function(deviceId) {
  await runWithActionLock(`return-to-supplier-${deviceId}`, async () => {
  const dev = db.inventory.find(d => d.id === deviceId);
  if (!dev || dev.status !== 'available') return;
  if (!isAdmin()) {
    alert('⛔ إرجاع القطع للموردين مخصص للمشرف (ADMIN) فقط.');
    return;
  }

  // بنحاول نلاقي حركة الشراء الأصلية لنفس الجهاز عشان نعرف بالظبط كان آجل
  // ولا كاش، ومين المورد (supplierId) بالضبط. لو مفيش (بيانات قديمة من قبل
  // إضافة relatedDeviceId)، بنرجع لبيانات الجهاز نفسه كحل احتياطي.
  const originalPurchaseTx = db.supplierTransactions.find(t => t.relatedDeviceId === deviceId && t.type === 'purchase');
  // FIX (توافق مع بيانات قديمة): أجهزة اتضافت قبل إصلاح الاستيراد الجماعي
  // مفيهاش supplierId خالص - بنحاول كحل أخير نلاقي المورد بمطابقة الاسم
  // النصي المخزَّن على الجهاز.
  const supplierId = originalPurchaseTx ? originalPurchaseTx.supplierId : (dev.supplierId || (db.suppliers.find(s => s.name === dev.supplier) || {}).id);
  const method = originalPurchaseTx ? originalPurchaseTx.method : (dev.purchaseMethod || 'credit');
  const supplierName = originalPurchaseTx ? originalPurchaseTx.supplierName : dev.supplier;

  const reason = (await customPrompt('سبب إرجاع القطعة للمورد (مثال: عيب مصنعي):', '', 'إرجاع قطعة للمورد')) || '';

  // FIX: السؤال عن استرداد نقدي كان بيظهر دايماً (حتى للمشتريات الآجلة
  // اللي أصلاً لسه ما اتدفعتش)، وكان بيستخدم زرار "تأكيد/إلغاء" العامين
  // لسؤال يس/نو حقيقي - فكان سهل جداً إنك تدوس "تأكيد" قصدك بس "أيوه كمّل
  // عملية الإرجاع" فيسجل النظام غلط إنك استلمت فلوس نقدية لحد ما اتفق عليه.
  // دلوقتي: (أ) لو الشراء كان بالآجل، مفيش أي سؤال عن نقدية خالص - منطقياً
  // مفيش حاجة اتدفعت أصلاً عشان تتسترد، فبنكتفي بتقليل المستحق للمورد
  // تلقائياً. (ب) لو كان كاش، بنسأل بأزرار واضحة المعنى تماماً ("نعم
  // استلمت المبلغ نقداً" / "لا لم أستلم شيء") بدل "تأكيد/إلغاء" العامة.
  let refund = false;
  if (method === 'cash') {
    refund = await customConfirm(
      `القطعة دي كانت مشتراة كاش بمبلغ ${dev.costPrice.toLocaleString()} ج.م. هل استلمت هذا المبلغ نقداً من المورد فعلاً الآن؟`,
      'استرداد قيمة القطعة نقداً',
      'نعم، استلمت المبلغ نقداً',
      'لا، لم أستلم شيء'
    );
  }

  const confirmed = await customConfirm(
    `تأكيد إرجاع الجهاز "${dev.brand} ${dev.name}" (SN: ${dev.serial}) للمورد ${supplierName}.\n\n${method === 'credit' ? `سيتم تخفيض المبلغ المستحق لهذا المورد بقيمة ${dev.costPrice.toLocaleString()} ج.م تلقائياً (لأن القطعة كانت آجلة ولم تُدفع بعد).` : (refund ? `تم تسجيل استرداد ${dev.costPrice.toLocaleString()} ج.م نقداً في الخزينة.` : 'لن يتم تسجيل أي حركة نقدية في الخزينة.')}`,
    'تأكيد نهائي',
    'نعم، تأكيد الإرجاع',
    'رجوع'
  );
  if (!confirmed) return;

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (refund) {
    const refundTx = {
      id: `tx-ref-${Date.now()}`,
      timestamp,
      type: 'deposit',
      amount: dev.costPrice,
      notes: `استرداد قيمة قطعة تالفة من المورد ${supplierName}: ${dev.brand} ${dev.name} (SN: ${dev.serial}) — ${reason}`
    };
    db.treasuryTransactions.unshift(refundTx);
    await syncWithAppsScript('addDeposit', { transaction: refundTx });
  }

  // الحركة الأساسية اللي كانت ناقصة: تسجيل المرتجع في سجل المورد نفسه.
  if (supplierId) {
    const returnTx = {
      id: `sptx-ret-${Date.now()}`,
      supplierId,
      supplierName,
      type: 'return',
      method,
      amount: safeNum(dev.costPrice),
      timestamp,
      date: timestamp.split(' ')[0],
      notes: `مرتجع قطعة تالفة/معيبة: ${dev.brand} ${dev.name} (SN: ${dev.serial}) — ${reason}${refund ? ' (تم استرداد القيمة نقداً)' : ''}`,
      relatedDeviceId: deviceId
    };
    db.supplierTransactions.unshift(returnTx);
    await syncWithAppsScript('addSupplierTransaction', { transaction: returnTx });
  }

  db.inventory = db.inventory.filter(d => d.id !== deviceId);
  logAction('إرجاع جهاز للمورد', `${dev.brand} ${dev.name} (SN: ${dev.serial}) للمورد ${supplierName} — ${reason}${refund ? ' (تم استرداد القيمة)' : ''}`);
  await syncWithAppsScript('deleteDevice', { id: deviceId });

  closeModal('device-actions-modal');
  renderInventory();
  renderSuppliers();
  renderTreasury();
  renderDashboard();
  });
};

// طباعة ملصق بسيط للقطعة (باركود بصري + بيانات أساسية) في نافذة جديدة قابلة للطباعة
window.printDeviceLabel = function(deviceId) {
  const dev = db.inventory.find(d => d.id === deviceId);
  if (!dev) return;

  const win = window.open('', '_blank', 'width=420,height=300');
  const barsHtml = Array.from({ length: 40 }).map(() => {
    const w = 1 + Math.floor(Math.random() * 3);
    return `<div style="width:${w}px;background:#0f172a;height:100%;"></div>`;
  }).join('');

  win.document.write(`
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <title>ملصق ${escapeHTML(dev.serial)}</title>
      <style>
        body { font-family: 'Tahoma', sans-serif; padding: 16px; }
        .label { border: 1px dashed #94a3b8; border-radius: 8px; padding: 12px; width: 320px; }
        .barcode { display: flex; gap: 1px; height: 45px; margin: 8px 0; align-items: stretch; }
        .row { display:flex; justify-content: space-between; font-size: 12px; margin: 2px 0; }
      </style>
    </head>
    <body onload="window.print()">
      <div class="label">
        <div style="font-weight:bold; font-size:14px;">${escapeHTML(dev.brand)} ${escapeHTML(dev.name)}</div>
        <div class="barcode">${barsHtml}</div>
        <div style="text-align:center; font-family: monospace; font-size: 13px; letter-spacing: 2px;">${escapeHTML(dev.serial)}</div>
        <div class="row"><span>السعر:</span><strong>${dev.sellingPrice.toLocaleString()} ج.م</strong></div>
        <div class="row"><span>الحالة:</span><strong>${DEVICE_CONDITION_LABELS[dev.condition] || '-'}</strong></div>
        <div class="row"><span>الفرع:</span><strong>${escapeHTML(dev.branch || '-')}</strong></div>
      </div>
    </body>
    </html>
  `);
  win.document.close();
};

// ================= تصدير / استيراد المخزون بصيغة CSV =================
window.exportInventoryCSV = function() {
  const headers = ['الماركة', 'الموديل', 'السيريال', 'الحالة', 'الفرع', 'المورد', 'سعر التكلفة', 'سعر البيع', 'حالة القطعة', 'الضمان (شهر)', 'تاريخ الإضافة', 'ملاحظات'];
  const rows = db.inventory.map(d => [
    d.brand, d.name, d.serial, DEVICE_STATUS_LABELS[d.status] || d.status, d.branch || '', d.supplier || '',
    d.costPrice, d.sellingPrice, DEVICE_CONDITION_LABELS[d.condition] || '', d.warrantyMonths || 0, d.addedDate || '', (d.notes || '').replace(/\n/g, ' ')
  ]);
  const csvContent = '\uFEFF' + [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory_export_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

window.submitImportInventory = async function() {
  await runWithActionLock("submit-import-inventory", async () => {
  const text = document.getElementById('import-inventory-textarea').value.trim();
  if (!text) { alert('يرجى لصق البيانات أولاً.'); return; }

  // FIX: كان الاستيراد الجماعي بيسجّل كل الأجهزة كـ"شراء كاش" في الخزينة
  // مباشرة، من غير ما يسجّل أي حركة في سجل حساب المورد (supplierTransactions)
  // خالص - يعني الأجهزة دي كانت "غير مرئية" تماماً لرصيد المورد من لحظة
  // إضافتها (مش بس وقت حذفها). دلوقتي بنطلب اختيار المورد وطريقة الدفع
  // مرة واحدة للدفعة كلها (زي شاشة "إضافة جهاز" الفردية بالظبط)، ونسجّل
  // حركة شراء مرتبطة بالمورد لكل قطعة، ونخصم من الخزينة فقط لو "كاش".
  const supplierId = document.getElementById('import-inventory-supplier').value;
  const paymentMethod = document.getElementById('import-inventory-payment-method').value;
  const supplierObj = db.suppliers.find(s => s.id === supplierId);
  if (!supplierObj) {
    alert('⚠️ برجاء اختيار المورد المشتري منه الدفعة كلها أولاً.');
    return;
  }
  const supplierName = supplierObj.name;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let added = 0, skipped = [];
  const syncPromises = [];

  lines.forEach((line, idx) => {
    // الصيغة المتوقعة لكل سطر: الماركة,الموديل,السيريال,سعر التكلفة,سعر البيع,الفرع(اختياري)
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 5) { skipped.push(`سطر ${idx + 1}: بيانات ناقصة`); return; }
    const [brand, name, serial, costStr, priceStr, branch = 'الفرع الرئيسي'] = parts;
    const costPrice = parseFloat(costStr);
    const sellingPrice = parseFloat(priceStr);

    if (!brand || !name || !serial || isNaN(costPrice) || isNaN(sellingPrice)) {
      skipped.push(`سطر ${idx + 1}: بيانات غير صحيحة`);
      return;
    }
    if (isDuplicateSerial(serial)) {
      skipped.push(`سطر ${idx + 1}: السيريال (${serial}) مكرر`);
      return;
    }

    const newDevice = {
      id: `dev-${Date.now()}-${idx}`,
      brand, name, serial, costPrice, sellingPrice,
      supplier: supplierName, supplierId, purchaseMethod: paymentMethod,
      status: 'available', soldTo: '', condition: 'new', warrantyMonths: 0,
      branch, minQty: 3, notes: '', addedDate: todayDate, history: []
    };
    addDeviceHistory(newDevice, 'استيراد دفعة', `تمت إضافة القطعة عبر الاستيراد الجماعي من المورد ${supplierName} (${paymentMethod === 'credit' ? 'آجل' : 'كاش'})`);
    db.inventory.push(newDevice);

    let purchaseTx = null;
    if (paymentMethod === 'cash') {
      purchaseTx = {
        id: `tx-pur-imp-${Date.now()}-${idx}`,
        timestamp, type: 'inventory_purchase', amount: -costPrice,
        notes: `شراء قطعة ${brand} ${name} (SN: ${serial}) عبر الاستيراد الجماعي من ${supplierName}`
      };
      db.treasuryTransactions.unshift(purchaseTx);
    }

    // الحركة الأساسية اللي كانت ناقصة بالكامل: تسجيل الشراء في سجل المورد.
    const supplierTx = {
      id: `sptx-imp-${Date.now()}-${idx}`,
      supplierId,
      supplierName,
      type: 'purchase',
      method: paymentMethod,
      amount: costPrice,
      timestamp,
      date: todayDate,
      notes: `شراء قطعة ${brand} ${name} (SN: ${serial}) عبر الاستيراد الجماعي`,
      relatedDeviceId: newDevice.id
    };
    db.supplierTransactions.unshift(supplierTx);

    syncPromises.push(syncWithAppsScript('addDevice', { newDevice, timestamp, transaction: purchaseTx }));
    syncPromises.push(syncWithAppsScript('addSupplierTransaction', { transaction: supplierTx }));
    added++;
  });

  if (added > 0) {
    logAction('استيراد مخزون جماعي', `تمت إضافة ${added} قطعة عبر الاستيراد الجماعي من المورد ${supplierName} (${paymentMethod === 'credit' ? 'آجل' : 'كاش'})`);
  }
  if (syncPromises.length > 0) await Promise.all(syncPromises);

  let resultMsg = `تم استيراد ${added} قطعة بنجاح من المورد ${supplierName}.`;
  if (skipped.length > 0) resultMsg += `\n\nتم تجاهل ${skipped.length} سطر:\n${skipped.join('\n')}`;
  alert(resultMsg);

  document.getElementById('import-inventory-textarea').value = '';
  closeModal('import-inventory-modal');
  renderInventory();
  renderTreasury();
  renderSuppliers();
  renderDashboard();
  });
};

// --- 3B. SUPPLIERS (الموردين) ---
// نظام إدارة الموردين: بيانات + فواتير شراء (كاش/آجل) + أرصدة مستحقة + سدادات.
// المنطق المحاسبي: كل عملية شراء "كاش" بتتخصم فوراً من الخزينة (زي ما كان الحال
// قبل كده) ومالهاش أي أثر على رصيد المورد. كل عملية شراء "آجل" بتتسجل كمستحق
// على المورد (تزود رصيده) من غير ما تلمس الخزينة إطلاقاً، لحد ما يتم سداد دفعة
// فعلية للمورد من تبويب الموردين، وهي اللي بتخصم من الخزينة وتقلل رصيده.
function computeSupplierBalance(supplierId) {
  const txs = db.supplierTransactions.filter(t => t.supplierId === supplierId);
  const creditPurchases = txs.filter(t => t.type === 'purchase' && t.method === 'credit');
  const cashPurchases = txs.filter(t => t.type === 'purchase' && t.method === 'cash');
  const payments = txs.filter(t => t.type === 'payment');
  // FEATURE: مرتجع للمورد (قطعة تالفة/معيبة بترجع له). بنخصمها من نفس نوع
  // الشراء الأصلي (آجل/كاش) اللي اترجعت منه، عشان الرصيد المستحق للمورد
  // ينزل صح لو كانت آجلة ولسه ما اتدفعتش، أو يظهر كـ"رصيد دائن لنا" لو
  // طلع إننا كنا دافعين قيمتها فعلاً قبل كده.
  const creditReturns = txs.filter(t => t.type === 'return' && t.method === 'credit');
  const cashReturns = txs.filter(t => t.type === 'return' && t.method === 'cash');

  const totalCreditPurchases = creditPurchases.reduce((s, t) => s + safeNum(t.amount), 0) - creditReturns.reduce((s, t) => s + safeNum(t.amount), 0);
  const totalCashPurchases = cashPurchases.reduce((s, t) => s + safeNum(t.amount), 0) - cashReturns.reduce((s, t) => s + safeNum(t.amount), 0);
  const totalPaid = payments.reduce((s, t) => s + safeNum(t.amount), 0);
  const totalPurchases = totalCreditPurchases + totalCashPurchases;
  // FIX (تقرير الفحص - بند ٤.١): كان الرصيد بيتقصّ عند صفر (Math.max(0, ...))
  // فلو دفعنا للمورد أكتر من مشترياتنا الآجلة منه (سلفة/دفعة مقدمة) كان
  // الفارق بيختفي تماماً. دلوقتي بنحتفظ بالقيمة الحقيقية (ممكن تكون سالبة)
  // في rawBalance، وbalance بتفضل موجبة زي الأول (للتوافق مع أي كود قديم
  // بيستخدمها كـ"المستحق للمورد")، وبنضيف advancePayment كحقل واضح منفصل
  // يوضح أي رصيد دائن لنا عند المورد.
  const rawBalance = totalCreditPurchases - totalPaid;
  const balance = Math.max(0, rawBalance);
  const advancePayment = Math.max(0, -rawBalance);

  return {
    transactions: sortByTimestampDesc(txs),
    totalCreditPurchases,
    totalCashPurchases,
    totalPurchases,
    totalPaid,
    balance,
    rawBalance,
    advancePayment
  };
}

let expandedSupplierIds = new Set();
window.toggleSupplierRow = function(supplierId) {
  if (expandedSupplierIds.has(supplierId)) {
    expandedSupplierIds.delete(supplierId);
  } else {
    expandedSupplierIds.add(supplierId);
  }
  renderSuppliers();
};

const SUPPLIER_TYPE_LABELS = { credit: 'آجل', cash: 'كاش', both: 'كاش / آجل' };
const SUPPLIER_TYPE_BADGE_CLASS = { credit: 'badge-warning', cash: 'badge-success', both: 'badge-info' };

function renderSuppliers() {
  const searchVal = (document.getElementById('supplier-search-input').value || '').toLowerCase();
  const listContainer = document.getElementById('suppliers-list');
  const emptyState = document.getElementById('suppliers-empty-state');
  // FIX: نفس الحماية العامة ضد 'innerHTML of null'
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const filtered = db.suppliers.filter(s =>
    (s.name || '').toLowerCase().includes(searchVal) || (s.phone || '').includes(searchVal)
  );

  document.getElementById('supplier-summary-count').textContent = db.suppliers.length;

  if (db.suppliers.length === 0) {
    emptyState.classList.remove('hidden');
    document.getElementById('supplier-summary-total-purchases').textContent = '0';
    document.getElementById('supplier-summary-paid').textContent = '0';
    document.getElementById('supplier-summary-due').textContent = '0';
    renderPaginationControls('suppliers', 1, 1, 0, 'suppliers-list', renderSuppliers);
    return;
  }
  emptyState.classList.add('hidden');

  const userIsAdminForSupplierView = isAdmin();

  // IMPROVEMENT #1 (الأداء): الإجماليات فوق الصفحة بتتحسب على كل الموردين
  // المفلترين، ورسم البطاقات بيتقسم لصفحات (25 مورد بالصفحة).
  let grandPurchases = 0, grandPaid = 0, grandDue = 0;
  filtered.forEach(supplier => {
    const b = computeSupplierBalance(supplier.id);
    grandPurchases += b.totalPurchases;
    grandPaid += b.totalPaid;
    grandDue += b.balance;
  });

  const pageItems = paginate('suppliers', filtered, 'suppliers-list', renderSuppliers);

  pageItems.forEach(supplier => {
    const bal = computeSupplierBalance(supplier.id);

    const isExpanded = expandedSupplierIds.has(supplier.id);
    const typeLabel = SUPPLIER_TYPE_LABELS[supplier.type] || 'آجل';
    const typeBadge = SUPPLIER_TYPE_BADGE_CLASS[supplier.type] || 'badge-warning';

    const card = document.createElement('div');
    card.className = 'glass-card rounded-2xl overflow-hidden';
    card.innerHTML = `
      <div class="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
        <div onclick="toggleSupplierRow('${supplier.id}')" class="flex items-center gap-3 cursor-pointer select-none flex-1 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-sm shrink-0">
            <i class="ph ${isExpanded ? 'ph-folder-open' : 'ph-truck'} text-lg"></i>
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="font-bold text-slate-800 text-md truncate">${escapeHTML(supplier.name)}</h4>
              <span class="badge ${typeBadge}">${typeLabel}</span>
            </div>
            <p class="text-xs text-slate-400 font-mono mt-0.5">هاتف: ${escapeHTML(supplier.phone) || '-'} ${supplier.address ? '| ' + escapeHTML(supplier.address) : ''}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-semibold">
          <div class="bg-slate-100 text-slate-700 py-1.5 px-3 rounded-lg">إجمالي المشتريات: <span class="font-black text-sm">${bal.totalPurchases.toLocaleString()} ج.م</span></div>
          <div class="bg-emerald-50 text-emerald-700 py-1.5 px-3 rounded-lg">المسدد: <span class="font-black text-sm">${bal.totalPaid.toLocaleString()} ج.م</span></div>
          <div class="bg-amber-50 text-amber-700 py-1.5 px-3 rounded-lg">المستحق: <span class="font-black text-sm">${bal.balance.toLocaleString()} ج.م</span></div>
          ${bal.advancePayment > 0 ? `<div class="bg-indigo-50 text-indigo-700 py-1.5 px-3 rounded-lg" title="مبلغ مدفوع للمورد أكثر من مشترياتنا الآجلة منه - رصيد دائن لنا عنده">رصيد دائن لنا: <span class="font-black text-sm">${bal.advancePayment.toLocaleString()} ج.م</span></div>` : ''}
          <div class="inline-flex gap-1.5">
            ${bal.balance > 0 ? `<button onclick="openSupplierPaymentModal('${supplier.id}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-hand-coins"></i> سداد</button>` : ''}
            <button onclick="printSupplierStatement('${supplier.id}')" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-printer"></i></button>
            <button onclick="editSupplier('${supplier.id}')" class="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-note-pencil"></i></button>
            <button onclick="deleteSupplier('${supplier.id}')" class="p-1.5 text-rose-500 hover:bg-rose-50 rounded-md text-xs transition-all"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      </div>

      <div class="${isExpanded ? '' : 'hidden'} border-t border-slate-100 p-4 space-y-4">
        ${(() => {
          // FEATURE: قايمة الأجهزة المتاحة حالياً من المورد ده، مع زرار
          // "مرتجع" جنب كل جهاز مباشرة من صفحة المورد نفسها - بدل ما تضطر
          // تروح تبويب المخزون وتدوّر عليه هناك. بيستخدم بالظبط نفس دالة
          // returnDeviceToSupplier اللي بتخصم من المخزون ومن رصيد المورد
          // مع بعض بشكل صحيح ومترابط.
          const supplierDevices = db.inventory.filter(d => d.status === 'available' && (d.supplierId === supplier.id || (!d.supplierId && d.supplier === supplier.name)));
          if (supplierDevices.length === 0) return '';
          return `
          <div>
            <h5 class="text-xs font-bold text-slate-500 mb-2 flex items-center gap-1.5"><i class="ph ph-package"></i> الأجهزة المتاحة حالياً من هذا المورد (${supplierDevices.length})</h5>
            <div class="flex flex-wrap gap-2">
              ${supplierDevices.map(d => `
                <div class="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg pl-1 pr-2.5 py-1 text-xs">
                  <span class="font-semibold text-slate-700">${escapeHTML(d.brand)} ${escapeHTML(d.name)}</span>
                  <span class="font-mono text-slate-400">${escapeHTML(d.serial)}</span>
                  ${userIsAdminForSupplierView ? `<button onclick="returnDeviceToSupplier('${d.id}')" title="إرجاع هذه القطعة للمورد" class="p-1 text-rose-500 hover:bg-rose-100 rounded-md"><i class="ph ph-arrow-u-up-left"></i></button>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
          `;
        })()}
        ${bal.transactions.length === 0 ? '<p class="text-xs text-slate-400 text-center py-4">لا توجد حركات مسجلة لهذا المورد بعد.</p>' : `
        <div class="overflow-x-auto">
          <table class="w-full text-right border-collapse text-xs">
            <thead>
              <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                <th class="p-2.5">التاريخ</th>
                <th class="p-2.5">نوع الحركة</th>
                <th class="p-2.5">البيان</th>
                <th class="p-2.5">طريقة الدفع</th>
                <th class="p-2.5">المبلغ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              ${bal.transactions.map(t => `
                <tr>
                  <td class="p-2.5 font-mono text-slate-500">${escapeHTML(t.timestamp)}</td>
                  <td class="p-2.5 font-bold">${t.type === 'purchase' ? 'شراء بضاعة' : (t.type === 'return' ? 'مرتجع للمورد' : 'سداد دفعة')}</td>
                  <td class="p-2.5">${escapeHTML(t.notes) || '-'}</td>
                  <td class="p-2.5">${(t.type === 'purchase' || t.type === 'return') ? (t.method === 'credit' ? '<span class="badge badge-warning">آجل</span>' : '<span class="badge badge-success">كاش</span>') : '<span class="badge badge-info">سداد نقدي</span>'}</td>
                  <td class="p-2.5 font-mono font-bold ${t.type === 'payment' || t.type === 'return' ? 'text-emerald-600' : (t.method === 'credit' ? 'text-amber-600' : 'text-slate-600')}">${t.type === 'return' ? '-' : ''}${t.amount.toLocaleString()} ج.م</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        `}
      </div>
    `;
    listContainer.appendChild(card);
  });

  document.getElementById('supplier-summary-total-purchases').textContent = grandPurchases.toLocaleString();
  document.getElementById('supplier-summary-paid').textContent = grandPaid.toLocaleString();
  document.getElementById('supplier-summary-due').textContent = grandDue.toLocaleString();
}

document.getElementById('supplier-search-input').addEventListener('input', debouncedSearch('suppliers', renderSuppliers));

window.openAddSupplierModal = function() {
  document.getElementById('supplier-edit-id').value = '';
  document.getElementById('add-supplier-form').reset();
  document.getElementById('supplier-modal-title').textContent = 'تسجيل تاجر / مورد جديد';
  openModal('add-supplier-modal');
};

window.editSupplier = function(supplierId) {
  const s = db.suppliers.find(x => x.id === supplierId);
  if (!s) return;
  document.getElementById('supplier-edit-id').value = s.id;
  document.getElementById('supplier-name').value = s.name || '';
  document.getElementById('supplier-phone').value = s.phone || '';
  document.getElementById('supplier-type').value = s.type || 'credit';
  document.getElementById('supplier-address').value = s.address || '';
  document.getElementById('supplier-notes').value = s.notes || '';
  document.getElementById('supplier-modal-title').textContent = 'تعديل بيانات المورد';
  openModal('add-supplier-modal');
};

window.deleteSupplier = async function(supplierId) {
  const bal = computeSupplierBalance(supplierId);
  if (bal.balance > 0) {
    alert(`⛔ لا يمكن حذف هذا المورد لأن له رصيداً مستحقاً قدره ${bal.balance.toLocaleString()} ج.م. برجاء سداد الرصيد أولاً.`);
    return;
  }
  // FIX (تقرير الفحص - بند ٤.١): منع حذف مورد لسه ليه رصيد دائن لنا عنده
  // (دفعنا له أكتر من مشترياتنا الآجلة) عشان ميضيعش الأثر المحاسبي للمبلغ ده.
  if (bal.advancePayment > 0) {
    alert(`⛔ لا يمكن حذف هذا المورد لوجود رصيد دائن لنا عنده قدره ${bal.advancePayment.toLocaleString()} ج.م (دفعنا له أكثر من مشترياتنا الآجلة). برجاء تسوية هذا الرصيد أولاً.`);
    return;
  }
  if (await customConfirm('هل أنت متأكد من حذف هذا المورد نهائياً من النظام؟ لا يمكن الرجوع عن هذا الخيار.')) {
    const supplier = db.suppliers.find(s => s.id === supplierId);
    db.suppliers = db.suppliers.filter(s => s.id !== supplierId);
    if (supplier) logAction('حذف مورد', `حذف المورد ${supplier.name} من السجلات`);
    renderSuppliers();
    populateDropdowns();
    await syncWithAppsScript('deleteSupplier', { id: supplierId, name: supplier ? supplier.name : '' });
  }
};

document.getElementById('add-supplier-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('supplier-edit-id').value;
  const name = document.getElementById('supplier-name').value;
  const phone = document.getElementById('supplier-phone').value;
  const type = document.getElementById('supplier-type').value || 'credit';
  const address = document.getElementById('supplier-address').value;
  const notes = document.getElementById('supplier-notes').value;

  if (editId) {
    const s = db.suppliers.find(x => x.id === editId);
    if (!s) return;
    s.name = name; s.phone = phone; s.type = type; s.address = address; s.notes = notes;
    logAction('تعديل مورد', `تعديل بيانات المورد ${name}`);
    await syncWithAppsScript('updateSupplier', s);
  } else {
    const supplierObj = {
      id: `sup-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name, phone, type, address, notes
    };
    db.suppliers.push(supplierObj);
    logAction('إضافة مورد', `تم إضافة مورد جديد ${name} (${SUPPLIER_TYPE_LABELS[type] || type})`);
    await syncWithAppsScript('addSupplier', supplierObj);
  }

  closeModal('add-supplier-modal');
  document.getElementById('add-supplier-form').reset();
  populateDropdowns();
  renderSuppliers();
  renderInventory();
});

window.openSupplierPaymentModal = function(supplierId) {
  const s = db.suppliers.find(x => x.id === supplierId);
  if (!s) return;
  const bal = computeSupplierBalance(supplierId);
  document.getElementById('supplier-payment-form').reset();
  document.getElementById('supplier-payment-id').value = supplierId;
  document.getElementById('supplier-payment-name').textContent = s.name;
  document.getElementById('supplier-payment-current-balance').textContent = `${bal.balance.toLocaleString()} ج.م`;
  document.getElementById('supplier-payment-amount').max = bal.balance;
  openModal('supplier-payment-modal');
};

document.getElementById('supplier-payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const supplierId = document.getElementById('supplier-payment-id').value;
  const amount = parseFloat(document.getElementById('supplier-payment-amount').value);
  const notes = document.getElementById('supplier-payment-notes').value;
  const supplier = db.suppliers.find(s => s.id === supplierId);
  if (!supplier || !amount || amount <= 0) return;

  const bal = computeSupplierBalance(supplierId);
  if (amount > bal.balance) {
    alert(`⚠️ المبلغ المدخل (${amount.toLocaleString()} ج.م) أكبر من الرصيد المستحق فعلياً للمورد (${bal.balance.toLocaleString()} ج.م).`);
    return;
  }

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const treasuryTx = {
    id: `tx-suppay-${Date.now()}`,
    timestamp,
    type: 'supplier_payment',
    amount: -amount,
    notes: `سداد دفعة للمورد ${supplier.name}${notes ? ' - ' + notes : ''}`
  };
  db.treasuryTransactions.unshift(treasuryTx);

  const supplierTx = {
    id: `sptx-pay-${Date.now()}`,
    supplierId,
    supplierName: supplier.name,
    type: 'payment',
    method: 'cash',
    amount,
    timestamp,
    date: todayDate,
    notes: notes || 'سداد دفعة نقدية',
    relatedTreasuryTxId: treasuryTx.id
  };
  db.supplierTransactions.unshift(supplierTx);

  logAction('سداد مورد', `سداد مبلغ ${amount.toLocaleString()} ج.م للمورد ${supplier.name} من الخزينة`);

  await syncWithAppsScript('supplierPayment', { transaction: treasuryTx, supplierTransaction: supplierTx });

  closeModal('supplier-payment-modal');
  document.getElementById('supplier-payment-form').reset();
  renderSuppliers();
  renderTreasury();
  renderDashboard();
});

window.printSupplierStatement = function(supplierId) {
  const supplier = db.suppliers.find(s => s.id === supplierId);
  if (!supplier) return;
  const bal = computeSupplierBalance(supplierId);
  const companyName = db.settings.companyName || 'شركة SKY';

  if (bal.transactions.length === 0) {
    showToast('❌ لا توجد حركات مسجلة لهذا المورد لإصدار كشف حساب.', 'error');
    return;
  }

  const rows = bal.transactions.map(t => `
    <tr>
      <td>${escapeHTML(t.timestamp)}</td>
      <td>${t.type === 'purchase' ? 'شراء بضاعة' : (t.type === 'return' ? 'مرتجع للمورد' : 'سداد دفعة')}</td>
      <td>${escapeHTML(t.notes) || '-'}</td>
      <td>${(t.type === 'purchase' || t.type === 'return') ? (t.method === 'credit' ? 'آجل' : 'كاش') : 'سداد نقدي'}</td>
      <td>${t.type === 'return' ? '-' : ''}${t.amount.toLocaleString()} ج.م</td>
    </tr>
  `).join('');

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    <div class="print-doc-title">كشف حساب مورد</div>

    <div class="print-doc-row"><span>اسم المورد</span><strong>${escapeHTML(supplier.name)}</strong></div>
    <div class="print-doc-row"><span>رقم الهاتف</span><strong>${escapeHTML(supplier.phone) || '—'}</strong></div>
    <div class="print-doc-row"><span>العنوان</span><strong>${escapeHTML(supplier.address) || '—'}</strong></div>

    <div style="margin-top:14px; padding:10px 12px; background:#ecfdf5; border-radius:8px; display:flex; justify-content:space-around; text-align:center; font-size:0.85rem;">
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي المشتريات</div><strong>${bal.totalPurchases.toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي المسدد</div><strong style="color:#059669;">${bal.totalPaid.toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">الرصيد المستحق</div><strong style="color:#d97706;">${bal.balance.toLocaleString()} ج.م</strong></div>
      ${bal.advancePayment > 0 ? `<div><div style="color:#64748b; font-size:0.7rem;">رصيد دائن لنا عنده</div><strong style="color:#4f46e5;">${bal.advancePayment.toLocaleString()} ج.م</strong></div>` : ''}
    </div>

    <table class="print-doc-table" style="margin-top:14px;">
      <thead>
        <tr><th>التاريخ</th><th>نوع الحركة</th><th>البيان</th><th>طريقة الدفع</th><th>المبلغ</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="print-doc-signatures">
      <div>توقيع مسؤول الحسابات: ______________</div>
      <div>توقيع المورد: ______________</div>
    </div>
    <div class="print-doc-footer">تم إصدار هذا الكشف إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${new Date().toLocaleString('ar-EG')}</div>
  `;

  printHTML(html);
  logAction('طباعة كشف حساب مورد', `طباعة كشف حساب للمورد ${supplier.name}`);
};

// IMPROVEMENT #7: تقرير إجمالي لكل الموردين مع بعض (بدل ما يكون فيه بس
// طباعة لواحد لواحد). بيعرض جدول واحد فيه كل مورد: إجمالي المشتريات، إجمالي
// المسدد، الرصيد المستحق له، وأي رصيد دائن لنا عنده (لو موجود)، مع إجماليات
// عامة تحت الجدول. زر التصدير لملف Excel (CSV) موجود بجانب زر الطباعة.
window.printAllSuppliersStatement = function() {
  if (db.suppliers.length === 0) {
    showToast('❌ لا يوجد موردين مسجلين لإصدار تقرير عنهم.', 'error');
    return;
  }
  const companyName = db.settings.companyName || 'شركة SKY';

  let grandPurchases = 0, grandPaid = 0, grandDue = 0, grandAdvance = 0;
  const rows = db.suppliers.map(supplier => {
    const bal = computeSupplierBalance(supplier.id);
    grandPurchases += bal.totalPurchases;
    grandPaid += bal.totalPaid;
    grandDue += bal.balance;
    grandAdvance += bal.advancePayment;
    return `
      <tr>
        <td>${escapeHTML(supplier.name)}</td>
        <td>${escapeHTML(supplier.phone) || '—'}</td>
        <td>${bal.totalPurchases.toLocaleString()} ج.م</td>
        <td>${bal.totalPaid.toLocaleString()} ج.م</td>
        <td style="font-weight:700; ${bal.balance > 0 ? 'color:#d97706;' : ''}">${bal.balance.toLocaleString()} ج.م</td>
        <td style="${bal.advancePayment > 0 ? 'color:#4f46e5; font-weight:700;' : 'color:#94a3b8;'}">${bal.advancePayment > 0 ? bal.advancePayment.toLocaleString() + ' ج.م' : '—'}</td>
      </tr>
    `;
  }).join('');

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    <div class="print-doc-title">تقرير إجمالي - كل الموردين (${db.suppliers.length})</div>

    <div style="margin-top:10px; padding:10px 12px; background:#ecfdf5; border-radius:8px; display:flex; justify-content:space-around; text-align:center; font-size:0.85rem; flex-wrap:wrap; gap:8px;">
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي مشتريات كل الموردين</div><strong>${grandPurchases.toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي المسدد لهم</div><strong style="color:#059669;">${grandPaid.toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي المستحق لهم</div><strong style="color:#d97706;">${grandDue.toLocaleString()} ج.م</strong></div>
      ${grandAdvance > 0 ? `<div><div style="color:#64748b; font-size:0.7rem;">إجمالي أرصدة دائنة لنا</div><strong style="color:#4f46e5;">${grandAdvance.toLocaleString()} ج.م</strong></div>` : ''}
    </div>

    <table class="print-doc-table" style="margin-top:14px;">
      <thead>
        <tr><th>اسم المورد</th><th>الهاتف</th><th>إجمالي المشتريات</th><th>إجمالي المسدد</th><th>المستحق له</th><th>رصيد دائن لنا</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="print-doc-footer">تم إصدار هذا التقرير إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${new Date().toLocaleString('ar-EG')} — إجمالي ${db.suppliers.length} مورد</div>
  `;

  printHTML(html);
  logAction('طباعة تقرير موردين إجمالي', `طباعة تقرير إجمالي لكل الموردين (${db.suppliers.length} مورد)`);
};

// IMPROVEMENT #7: تصدير نفس بيانات كل الموردين كملف Excel (CSV) قابل للفتح
// في Excel مباشرة، بنفس فلسفة تصدير باقي التبويبات في النظام (لو موجودة).
window.exportAllSuppliersCSV = function() {
  if (db.suppliers.length === 0) {
    showToast('❌ لا يوجد موردين مسجلين لتصديرهم.', 'error');
    return;
  }
  const headers = ['اسم المورد', 'الهاتف', 'العنوان', 'إجمالي المشتريات', 'إجمالي المسدد', 'المستحق له', 'رصيد دائن لنا'];
  const rows = db.suppliers.map(supplier => {
    const bal = computeSupplierBalance(supplier.id);
    return [supplier.name, supplier.phone || '', supplier.address || '', bal.totalPurchases, bal.totalPaid, bal.balance, bal.advancePayment];
  });
  const csvContent = '\uFEFF' + [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `تقرير_الموردين_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  logAction('تصدير تقرير موردين', `تصدير كشف Excel/CSV إجمالي لكل الموردين (${db.suppliers.length} مورد)`);
};

// --- 3C. GENERAL PRODUCTS & CATEGORIES (الأصناف والمنتجات العامة - إكسسوارات/قطع غيار) ---
// نظام مستقل تماماً عن مخزون الأجهزة (اللي بيتتبع بالسيريال الفردي)، مخصص
// للمنتجات اللي بتتباع/تُستخدم بالعدد (كمية) بدون سيريال فردي، زي الإكسسوارات
// وقطع الغيار ومستلزمات الصيانة. الكمية الحالية لكل منتج بتتحسب دايماً من
// مجموع حركات الوارد ناقص الصادر (بنفس فلسفة حساب رصيد المورد أعلاه) عشان
// تفضل متزامنة ودقيقة دايماً بدل ما نخزنها كرقم منفصل ممكن يحصل فيه تعارض.

const PRODUCT_MOVEMENT_REASON_LABELS = {
  purchase: 'شراء من مورد',
  cash_sale: 'بيع كاش',
  consumption: 'استهلاك داخلي',
  damage: 'تالف / هالك',
  adjustment: 'تسوية جرد'
};

function computeProductQuantity(productId) {
  const movements = db.productStockMovements.filter(m => m.productId === productId);
  const totalIn = movements.filter(m => m.type === 'in').reduce((s, m) => s + m.quantity, 0);
  const totalOut = movements.filter(m => m.type === 'out').reduce((s, m) => s + m.quantity, 0);
  return totalIn - totalOut;
}

let selectedProductCategoryId = ''; // '' = عرض كل الأصناف
let expandedProductId = null; // لعرض سجل حركات منتج معين

window.selectProductCategory = function(categoryId) {
  selectedProductCategoryId = categoryId;
  renderProducts();
};

window.toggleProductMovements = function(productId) {
  expandedProductId = (expandedProductId === productId) ? null : productId;
  renderProducts();
};

let selectedBrandName = ''; // لفلترة المنتجات حسب الماركة أيضاً

window.selectProductBrand = function(brandName) {
  selectedBrandName = (selectedBrandName === brandName) ? '' : brandName;
  renderProducts();
};

function renderProductCategoryChips() {
  const container = document.getElementById('product-categories-chips');
  if (!container) return;
  const allCount = db.products.length;
  let html = `
    <button onclick="selectedBrandName=''; selectProductCategory('')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedProductCategoryId === '' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">
      الكل <span class="opacity-70">(${allCount})</span>
    </button>
  `;
  db.productCategories.forEach(cat => {
    const isActive = selectedProductCategoryId === cat.id;
    html += `
      <div class="inline-flex items-center gap-0.5 ${isActive ? 'bg-teal-600' : 'bg-slate-100'} rounded-lg pr-1 pl-1 py-1">
        <button onclick="selectedBrandName=''; selectProductCategory('${cat.id}')" class="px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${isActive ? 'text-white' : 'text-slate-600 hover:bg-slate-200'}">
          ${escapeHTML(cat.name)}
        </button>
        <button onclick="editProductCategory('${cat.id}')" title="تعديل الصنف" class="${isActive ? 'text-teal-100 hover:text-white' : 'text-slate-400 hover:text-teal-600'} text-sm p-2 min-w-[32px] min-h-[32px] flex items-center justify-center"><i class="ph ph-note-pencil"></i></button>
        <button onclick="deleteProductCategory('${cat.id}')" title="حذف الصنف" class="${isActive ? 'text-teal-100 hover:text-rose-200' : 'text-slate-400 hover:text-rose-600'} text-sm p-2 min-w-[32px] min-h-[32px] flex items-center justify-center border-r ${isActive ? 'border-teal-400' : 'border-slate-200'}"><i class="ph ph-trash"></i></button>
      </div>
    `;
  });
  container.innerHTML = html;

  // عرض الماركات التابعة للصنف المختار كأزرار فرعية
  const brandsContainer = document.getElementById('product-brands-chips');
  if (brandsContainer) {
    if (!selectedProductCategoryId) {
      brandsContainer.innerHTML = '';
      return;
    }
    const brands = db.brands.filter(b => typeof b === 'object' && b.categoryId === selectedProductCategoryId);
    let bHtml = '';
    brands.forEach(b => {
      const isActive = selectedBrandName === b.name;
      const count = db.products.filter(p => p.categoryId === selectedProductCategoryId && p.brand === b.name).length;
      bHtml += `
        <div class="inline-flex items-center gap-0.5 ${isActive ? 'bg-indigo-600' : 'bg-indigo-50'} rounded-lg pr-1 pl-1 py-1 border border-indigo-100">
          <button onclick="selectProductBrand('${b.name}')" class="px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all ${isActive ? 'text-white' : 'text-indigo-600 hover:bg-indigo-100'}">
            ${escapeHTML(b.name)} <span class="opacity-70">(${count})</span>
          </button>
          <button onclick="deleteBrand('${b.id}')" title="حذف الماركة" class="${isActive ? 'text-indigo-100 hover:text-rose-200' : 'text-indigo-300 hover:text-rose-600'} text-sm p-2 min-w-[32px] min-h-[32px] flex items-center justify-center border-r ${isActive ? 'border-indigo-400' : 'border-indigo-100'}"><i class="ph ph-trash"></i></button>
        </div>
      `;
    });
    brandsContainer.innerHTML = bHtml;
  }
}

function renderProducts() {
  renderProductCategoryChips();

  const searchInput = document.getElementById('product-search-input');
  const lowStockInput = document.getElementById('product-filter-lowstock');
  const searchVal = (searchInput ? searchInput.value : '').toLowerCase();
  const lowStockOnly = lowStockInput ? lowStockInput.checked : false;
  const tbody = document.getElementById('products-table-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  const emptyState = document.getElementById('products-empty-state');
  if (!tbody) return;
  tbody.innerHTML = '';

  let list = db.products.filter(p => {
    if (selectedProductCategoryId && p.categoryId !== selectedProductCategoryId) return false;
    if (selectedBrandName && p.brand !== selectedBrandName) return false;
    if (searchVal && !(p.name || '').toLowerCase().includes(searchVal)) return false;
    return true;
  });

  // ملخصات علوية
  const summaryCategories = document.getElementById('product-summary-categories');
  const summaryProducts = document.getElementById('product-summary-products');
  const summaryLowStock = document.getElementById('product-summary-lowstock');
  const summaryValue = document.getElementById('product-summary-value');
  if (summaryCategories) summaryCategories.textContent = db.productCategories.length;
  if (summaryProducts) summaryProducts.textContent = db.products.length;
  const lowStockProducts = db.products.filter(p => computeProductQuantity(p.id) <= (p.minQty || 0));
  if (summaryLowStock) summaryLowStock.textContent = lowStockProducts.length;
  const totalStockValue = db.products.reduce((sum, p) => sum + (computeProductQuantity(p.id) * safeNum(p.costPrice)), 0);
  if (summaryValue) summaryValue.textContent = totalStockValue.toLocaleString();

  if (lowStockOnly) {
    list = list.filter(p => computeProductQuantity(p.id) <= (p.minQty || 0));
  }

  if (list.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    renderPaginationControls('products', 1, 1, 0, 'products-table-wrapper', renderProducts);
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  // IMPROVEMENT #1 (الأداء): ترقيم صفحات للأصناف/المنتجات.
  const pageItems = paginate('products', list, 'products-table-wrapper', renderProducts);

  pageItems.forEach(p => {
    const cat = db.productCategories.find(c => c.id === p.categoryId);
    const qty = computeProductQuantity(p.id);
    const isLow = qty <= (p.minQty || 0);
    const sup = db.suppliers.find(s => s.id === p.defaultSupplierId);
    const isExpanded = expandedProductId === p.id;

    const row = document.createElement('tr');
    row.className = 'hover:bg-slate-50/60 transition-colors';
    row.innerHTML = `
      <td class="p-4">
        <div class="font-bold text-slate-800">${escapeHTML(p.name)}</div>
        <div class="text-[10px] text-slate-400">
          ${escapeHTML(cat ? cat.name : 'بدون صنف')} / ${escapeHTML(p.brand || 'بدون ماركة')}
        </div>
      </td>
      <td class="p-4 text-center">
        <span class="font-black text-sm ${isLow ? 'text-rose-600' : 'text-slate-700'}">${qty.toLocaleString()}</span>
        <span class="text-xs text-slate-400"> ${escapeHTML(p.unit || 'قطعة')}</span>
        ${isLow ? `<div><span class="badge badge-danger mt-1 inline-block">أوشك على النفاد</span></div>` : ''}
      </td>
      <td class="p-4 text-center text-slate-500 text-xs">${(p.minQty || 0).toLocaleString()}</td>
      <td class="p-4 text-slate-600 text-xs">${(p.costPrice || 0).toLocaleString()} ج.م</td>
      <td class="p-4 text-slate-600 text-xs">${(p.sellingPrice || 0).toLocaleString()} ج.م</td>
      <td class="p-4 text-slate-600 text-xs">${sup ? escapeHTML(sup.name) : '-'}</td>
      <td class="p-4">
        <div class="flex flex-wrap items-center justify-center gap-1.5">
          <button onclick="openStockInModal('${p.id}')" title="توريد كمية من مورد" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-arrow-down-left"></i> توريد</button>
          <button onclick="openStockOutModal('${p.id}')" title="صرف / بيع كمية" class="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-arrow-up-right"></i> صرف</button>
          <button onclick="toggleProductMovements('${p.id}')" title="سجل الحركات" class="p-1.5 text-indigo-500 hover:bg-indigo-50 rounded-md text-xs transition-all"><i class="ph ph-clock-counter-clockwise"></i></button>
          <button onclick="editProduct('${p.id}')" title="تعديل المنتج" class="p-1.5 text-teal-600 hover:bg-teal-50 rounded-md text-xs transition-all"><i class="ph ph-note-pencil"></i></button>
          <button onclick="deleteProduct('${p.id}')" title="حذف المنتج" class="p-1.5 text-rose-500 hover:bg-rose-50 rounded-md text-xs transition-all"><i class="ph ph-trash"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(row);

    if (isExpanded) {
      const movements = sortByTimestampDesc(db.productStockMovements.filter(m => m.productId === p.id));
      const detailsRow = document.createElement('tr');
      detailsRow.innerHTML = `
        <td colspan="7" class="p-0 bg-slate-50/60 border-t border-slate-100">
          <div class="p-4">
            ${movements.length === 0 ? '<p class="text-xs text-slate-400 text-center py-3">لا توجد حركات مسجلة لهذا المنتج بعد.</p>' : `
            <div class="overflow-x-auto">
            <table class="w-full text-right border-collapse text-xs">
              <thead>
                <tr class="bg-slate-100 text-slate-500 font-semibold text-[11px]">
                  <th class="p-2">التاريخ</th><th class="p-2">النوع</th><th class="p-2">السبب</th><th class="p-2">الكمية</th><th class="p-2">سعر الوحدة</th><th class="p-2">الإجمالي</th><th class="p-2">المورد</th><th class="p-2">ملاحظات</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 text-slate-700">
                ${movements.map(m => `
                  <tr>
                    <td class="p-2 font-mono text-slate-500">${escapeHTML(m.timestamp)}</td>
                    <td class="p-2">${m.type === 'in' ? '<span class="badge badge-success">وارد</span>' : '<span class="badge badge-warning">صادر</span>'}</td>
                    <td class="p-2">${escapeHTML(PRODUCT_MOVEMENT_REASON_LABELS[m.reason] || m.reason || '-')}</td>
                    <td class="p-2 font-bold">${m.quantity.toLocaleString()}</td>
                    <td class="p-2">${(m.unitCost || 0).toLocaleString()} ج.م</td>
                    <td class="p-2 font-bold">${(m.totalCost || 0).toLocaleString()} ج.م</td>
                    <td class="p-2">${escapeHTML(m.supplierName) || '-'}</td>
                    <td class="p-2">${escapeHTML(m.notes) || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            </div>
            `}
          </div>
        </td>
      `;
      tbody.appendChild(detailsRow);
    }
  });
}

const productSearchInputEl = document.getElementById('product-search-input');
if (productSearchInputEl) productSearchInputEl.addEventListener('input', debouncedSearch('products', renderProducts));
const productLowStockInputEl = document.getElementById('product-filter-lowstock');
if (productLowStockInputEl) productLowStockInputEl.addEventListener('change', renderProducts);

// ----- إدارة الأصناف (Categories CRUD) -----
window.openAddProductCategoryModal = function() {
  document.getElementById('product-category-edit-id').value = '';
  document.getElementById('add-product-category-form').reset();
  document.getElementById('product-category-modal-title').textContent = 'إضافة صنف جديد';
  openModal('add-product-category-modal');
};

window.editProductCategory = function(categoryId) {
  const cat = db.productCategories.find(c => c.id === categoryId);
  if (!cat) return;
  document.getElementById('product-category-edit-id').value = cat.id;
  document.getElementById('product-category-name').value = cat.name || '';
  document.getElementById('product-category-notes').value = cat.notes || '';
  document.getElementById('product-category-modal-title').textContent = 'تعديل الصنف';
  openModal('add-product-category-modal');
};

window.deleteProductCategory = async function(categoryId) {
  const productsInCategory = db.products.filter(p => p.categoryId === categoryId);
  if (productsInCategory.length > 0) {
    alert(`⛔ لا يمكن حذف هذا الصنف لأنه يحتوي على ${productsInCategory.length} منتج. احذف أو انقل المنتجات أولاً.`);
    return;
  }
  const brandsInCategory = db.brands.filter(b => b.categoryId === categoryId);
  if (brandsInCategory.length > 0) {
    alert(`⛔ لا يمكن حذف هذا الصنف لأنه يحتوي على ${brandsInCategory.length} ماركة تابعة له. احذف الماركات أولاً.`);
    return;
  }
  const cat = db.productCategories.find(c => c.id === categoryId);
  if (!cat) return;
  if (await customConfirm(`هل أنت متأكد من حذف صنف "${cat.name}" نهائياً؟`)) {
    db.productCategories = db.productCategories.filter(c => c.id !== categoryId);
    if (selectedProductCategoryId === categoryId) selectedProductCategoryId = '';
    logAction('حذف صنف منتجات', `حذف الصنف ${cat.name}`);
    renderProducts();
    populateDropdowns();
    await syncWithAppsScript('deleteProductCategory', { id: categoryId });
  }
};

document.getElementById('add-product-category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('product-category-edit-id').value;
  const name = document.getElementById('product-category-name').value.trim();
  const notes = document.getElementById('product-category-notes').value.trim();
  if (!name) return;

  if (editId) {
    const cat = db.productCategories.find(c => c.id === editId);
    if (!cat) return;
    cat.name = name; cat.notes = notes;
    logAction('تعديل صنف منتجات', `تعديل بيانات الصنف ${name}`);
    await syncWithAppsScript('updateProductCategory', cat);
  } else {
    const newCat = { id: `pcat-${Date.now()}-${Math.floor(Math.random() * 10000)}`, name, notes };
    db.productCategories.push(newCat);
    logAction('إضافة صنف منتجات', `إضافة صنف جديد: ${name}`);
    await syncWithAppsScript('addProductCategory', newCat);
  }

  closeModal('add-product-category-modal');
  renderProducts();
  populateDropdowns();
});

// ----- إدارة المنتجات (Products CRUD) -----
window.openAddProductModal = function() {
  document.getElementById('product-edit-id').value = '';
  document.getElementById('add-product-form').reset();
  document.getElementById('product-modal-title').textContent = 'إضافة منتج جديد';
  // نحدّث كل القوائم (الأصناف والموردين وغيرها) أول ما نفتح المودال، عشان
  // نضمن ظهور كل الأصناف المُضافة حتى لو المودال ده اتفتح قبل ما أي تحديث تاني يحصل.
  populateDropdowns();
  if (selectedProductCategoryId) document.getElementById('product-category-select').value = selectedProductCategoryId;
  // مهم: تحديث قائمة الماركات يدوياً هنا، لأن ضبط .value برمجياً فوق مبيطلقش
  // حدث change تلقائي، فقائمة الماركات كانت بتفضل فاضية أو بتعرض ماركات
  // صنف تاني (لو كان اتفتح قبل كده) لحد ما المستخدم يغيّر الصنف يدوياً.
  updateBrandDropdownForProduct();
  openModal('add-product-modal');
};

window.editProduct = function(productId) {
  const p = db.products.find(x => x.id === productId);
  if (!p) return;
  document.getElementById('product-edit-id').value = p.id;
  document.getElementById('product-name').value = p.name || '';
  populateDropdowns();
  document.getElementById('product-category-select').value = p.categoryId || '';
  
  // تحديث قائمة الماركات بناءً على التصنيف المختار
  updateBrandDropdownForProduct();
  document.getElementById('product-brand-select').value = p.brand || '';
  
  document.getElementById('product-unit').value = p.unit || 'قطعة';
  document.getElementById('product-min-qty').value = p.minQty || 0;
  document.getElementById('product-cost-price').value = p.costPrice || 0;
  document.getElementById('product-selling-price').value = p.sellingPrice || 0;
  document.getElementById('product-default-supplier').value = p.defaultSupplierId || '';
  document.getElementById('product-notes').value = p.notes || '';
  document.getElementById('product-modal-title').textContent = 'تعديل بيانات المنتج';
  openModal('add-product-modal');
};

window.openAddBrandModalForSelectedCategory = function() {
  document.getElementById('add-brand-form').reset();
  populateDropdowns();
  openModal('add-brand-modal');
  // لو فيه صنف محدد بالفعل (شريحة مضغوطة فوق)، بنختاره تلقائياً كتسهيل.
  // لو مفيش، القائمة هتفضل مفتوحة عادي وتقدر تختار أي صنف من الموجودين.
  if (selectedProductCategoryId) {
    document.getElementById('brand-category-select').value = selectedProductCategoryId;
  }
};

window.deleteBrand = async function(brandId) {
  const brand = db.brands.find(b => b.id === brandId);
  if (!brand) return;
  
  const productsWithBrand = db.products.filter(p => p.brand === brand.name && p.categoryId === brand.categoryId);
  if (productsWithBrand.length > 0) {
    alert(`⛔ لا يمكن حذف الماركة لأنها مرتبطة بـ ${productsWithBrand.length} منتج.`);
    return;
  }
  
  if (await customConfirm(`هل أنت متأكد من حذف ماركة "${brand.name}"؟`)) {
    db.brands = db.brands.filter(b => b.id !== brandId);
    logAction('حذف ماركة', `حذف الماركة ${brand.name}`);
    renderProducts();
    populateDropdowns();
    await syncWithAppsScript('deleteBrand', { id: brandId, name: brand.name });
  }
};

window.deleteProduct = async function(productId) {
  const qty = computeProductQuantity(productId);
  if (qty > 0) {
    alert(`⛔ لا يمكن حذف هذا المنتج لأن رصيده الحالي بالمخزون ${qty}. قم بصرف/تصفير الكمية أولاً قبل الحذف.`);
    return;
  }
  const p = db.products.find(x => x.id === productId);
  if (!p) return;
  if (await customConfirm(`هل أنت متأكد من حذف منتج "${p.name}" نهائياً؟`)) {
    db.products = db.products.filter(x => x.id !== productId);
    logAction('حذف منتج', `حذف المنتج ${p.name} من السجلات`);
    renderProducts();
    populateDropdowns();
    await syncWithAppsScript('deleteProduct', { id: productId });
  }
};

document.getElementById('add-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('product-edit-id').value;
  const name = document.getElementById('product-name').value.trim();
  const categoryId = document.getElementById('product-category-select').value;
  const unit = document.getElementById('product-unit').value.trim() || 'قطعة';
  const minQty = parseFloat(document.getElementById('product-min-qty').value) || 0;
  const costPrice = parseFloat(document.getElementById('product-cost-price').value) || 0;
  const sellingPrice = parseFloat(document.getElementById('product-selling-price').value) || 0;
  const defaultSupplierId = document.getElementById('product-default-supplier').value;
  const notes = document.getElementById('product-notes').value.trim();

  if (!name || !categoryId) { alert('يرجى إدخال اسم المنتج واختيار الصنف التابع له.'); return; }

  const brand = document.getElementById('product-brand-select').value;

  if (editId) {
    const p = db.products.find(x => x.id === editId);
    if (!p) return;
    p.name = name; p.categoryId = categoryId; p.brand = brand; p.unit = unit; p.minQty = minQty;
    p.costPrice = costPrice; p.sellingPrice = sellingPrice; p.defaultSupplierId = defaultSupplierId; p.notes = notes;
    logAction('تعديل منتج', `تعديل بيانات المنتج ${name}`);
    await syncWithAppsScript('updateProduct', p);
  } else {
    const newProduct = {
      id: `prod-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      categoryId, brand, name, unit, minQty, costPrice, sellingPrice, defaultSupplierId, notes
    };
    db.products.push(newProduct);
    logAction('إضافة منتج', `إضافة منتج جديد: ${name} (ماركة: ${brand})`);
    await syncWithAppsScript('addProduct', newProduct);
  }

  closeModal('add-product-modal');
  renderProducts();
  populateDropdowns();
});

// ----- توريد كمية من مورد (Stock In) -----
window.openStockInModal = function(productId) {
  const p = db.products.find(x => x.id === productId);
  if (!p) return;
  document.getElementById('stock-in-product-id').value = p.id;
  document.getElementById('stock-in-product-name').textContent = p.name;
  document.getElementById('stock-in-current-qty').textContent = `${computeProductQuantity(p.id).toLocaleString()} ${p.unit || 'قطعة'}`;
  populateDropdowns();
  const defaultSupplier = p.defaultSupplierId ? db.suppliers.find(s => s.id === p.defaultSupplierId) : null;
  document.getElementById('stock-in-supplier').value = defaultSupplier ? defaultSupplier.id : '';
  document.getElementById('stock-in-supplier-search').value = defaultSupplier ? formatSupplierOptionLabel(defaultSupplier) : '';
  document.getElementById('stock-in-supplier-results').classList.add('hidden');
  document.getElementById('stock-in-quantity').value = '';
  document.getElementById('stock-in-unit-cost').value = p.costPrice || 0;
  document.getElementById('stock-in-method').value = 'cash';
  document.getElementById('stock-in-notes').value = '';
  openModal('stock-in-modal');
};

document.getElementById('stock-in-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const productId = document.getElementById('stock-in-product-id').value;
  const p = db.products.find(x => x.id === productId);
  if (!p) return;

  const supplierId = document.getElementById('stock-in-supplier').value;
  const supplier = db.suppliers.find(s => s.id === supplierId);
  const quantity = parseFloat(document.getElementById('stock-in-quantity').value);
  const unitCost = parseFloat(document.getElementById('stock-in-unit-cost').value) || 0;
  const method = document.getElementById('stock-in-method').value || 'cash';
  const notes = document.getElementById('stock-in-notes').value.trim();

  if (!supplierId || !quantity || quantity <= 0) {
    alert('يرجى اختيار المورد وإدخال كمية صحيحة أكبر من صفر.');
    return;
  }

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayDate = timestamp.split(' ')[0];
  const totalCost = quantity * unitCost;

  const movement = {
    id: `pmov-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    productId: p.id, productName: p.name, type: 'in', reason: 'purchase',
    quantity, unitCost, totalCost, supplierId, supplierName: supplier ? supplier.name : '',
    timestamp, notes
  };
  db.productStockMovements.unshift(movement);

  // نفس منطق شراء الأجهزة بالظبط: كاش يخصم فوراً من الخزينة، آجل يتسجل كمستحق
  // على المورد فقط (من غير ما يلمس الخزينة إلا وقت السداد الفعلي لاحقاً).
  let treasuryTx = null;
  if (method !== 'credit') {
    treasuryTx = {
      id: `tx-ppur-${Date.now()}`,
      timestamp, type: 'product_purchase', amount: -totalCost,
      notes: `شراء ${quantity} ${p.unit || 'قطعة'} من "${p.name}" من المورد ${supplier ? supplier.name : ''}`
    };
    db.treasuryTransactions.unshift(treasuryTx);
  }

  const supplierTx = {
    id: `sptx-${Date.now()}`,
    supplierId, supplierName: supplier ? supplier.name : '',
    type: 'purchase', method, amount: totalCost, timestamp, date: todayDate,
    notes: `شراء ${quantity} ${p.unit || 'قطعة'} من "${p.name}"`,
    relatedProductId: p.id
  };
  db.supplierTransactions.unshift(supplierTx);

  // تحديث سعر التكلفة والمورد الافتراضي للمنتج ليعكسوا آخر عملية شراء فعلية
  p.costPrice = unitCost;
  p.defaultSupplierId = supplierId;

  logAction('توريد منتج', `توريد ${quantity} ${p.unit || 'قطعة'} من "${p.name}" من المورد ${supplier ? supplier.name : ''} (${method === 'credit' ? 'آجل' : 'كاش'})`);

  await syncWithAppsScript('stockInProduct', {
    movement, transaction: treasuryTx, supplierTransaction: supplierTx,
    product: { id: p.id, costPrice: p.costPrice, defaultSupplierId: p.defaultSupplierId }
  });

  closeModal('stock-in-modal');
  renderProducts();
  renderTreasury();
  renderDashboard();
});

// ----- صرف / بيع كمية (Stock Out) -----
window.openStockOutModal = function(productId) {
  const p = db.products.find(x => x.id === productId);
  if (!p) return;
  document.getElementById('stock-out-product-id').value = p.id;
  document.getElementById('stock-out-product-name').textContent = p.name;
  document.getElementById('stock-out-current-qty').textContent = `${computeProductQuantity(p.id).toLocaleString()} ${p.unit || 'قطعة'}`;
  document.getElementById('stock-out-quantity').value = '';
  document.getElementById('stock-out-reason').value = 'cash_sale';
  document.getElementById('stock-out-sale-price').value = p.sellingPrice || 0;
  document.getElementById('stock-out-notes').value = '';
  toggleStockOutSalePriceField();
  openModal('stock-out-modal');
};

window.toggleStockOutSalePriceField = function() {
  const reasonEl = document.getElementById('stock-out-reason');
  const wrapper = document.getElementById('stock-out-sale-price-wrapper');
  if (!reasonEl || !wrapper) return;
  wrapper.classList.toggle('hidden', reasonEl.value !== 'cash_sale');
};

document.getElementById('stock-out-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const productId = document.getElementById('stock-out-product-id').value;
  const p = db.products.find(x => x.id === productId);
  if (!p) return;

  const quantity = parseFloat(document.getElementById('stock-out-quantity').value);
  const reason = document.getElementById('stock-out-reason').value;
  const salePrice = parseFloat(document.getElementById('stock-out-sale-price').value) || 0;
  const notes = document.getElementById('stock-out-notes').value.trim();

  if (!quantity || quantity <= 0) { alert('يرجى إدخال كمية صحيحة أكبر من صفر.'); return; }

  const currentQty = computeProductQuantity(p.id);
  if (quantity > currentQty) {
    const proceed = await customConfirm(`الكمية المطلوب صرفها (${quantity}) أكبر من الرصيد الحالي بالمخزون (${currentQty}). هل تريد المتابعة رغم ذلك؟`);
    if (!proceed) return;
  }

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const totalSale = reason === 'cash_sale' ? quantity * salePrice : 0;

  const movement = {
    id: `pmov-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    productId: p.id, productName: p.name, type: 'out', reason,
    quantity, unitCost: reason === 'cash_sale' ? salePrice : 0, totalCost: totalSale,
    supplierId: '', supplierName: '', timestamp, notes
  };
  db.productStockMovements.unshift(movement);

  let treasuryTx = null;
  if (reason === 'cash_sale' && totalSale > 0) {
    treasuryTx = {
      id: `tx-psale-${Date.now()}`,
      timestamp, type: 'product_sale', amount: totalSale,
      // FEATURE: بنسجل تكلفة البضاعة المباعة (COGS) وقت البيع نفسه، بنفس
      // فلسفة بيع الأجهزة كاش، عشان حساب "الربح المُحقَّق فقط" يبقى دقيق.
      costPrice: safeNum(p.costPrice) * quantity,
      productId: p.id,
      notes: `بيع ${quantity} ${p.unit || 'قطعة'} من "${p.name}" كاش`
    };
    db.treasuryTransactions.unshift(treasuryTx);
  }

  const reasonLabel = PRODUCT_MOVEMENT_REASON_LABELS[reason] || reason;
  logAction('صرف منتج', `صرف ${quantity} ${p.unit || 'قطعة'} من "${p.name}" (${reasonLabel})`);

  await syncWithAppsScript('stockOutProduct', { movement, transaction: treasuryTx });

  closeModal('stock-out-modal');
  renderProducts();
  renderTreasury();
  renderDashboard();
});

// --- 4. CONTRACTS & SALES ---
function renderContracts() {
  const searchVal = document.getElementById('contract-search-input').value.toLowerCase();
  const tbody = document.getElementById('contracts-table-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  const emptyState = document.getElementById('contracts-empty-state');
  
  tbody.innerHTML = '';
  
  const filtered = db.contracts.filter(c => 
    (c.clientName || '').toLowerCase().includes(searchVal) || 
    (c.id || '').includes(searchVal)
  );

  // FIX: العقود كانت بتتعرض بترتيب عشوائي (زي ما بتيجي من Firebase، ومفيش
  // ضمان إنها هترجع بترتيب معين). دلوقتي بنرتبها من الأحدث للأقدم: نستخدم
  // createdAt (طابع زمني دقيق) لو موجود، ولو مش موجود (عقود قديمة اتعملت
  // قبل إضافة الحقل ده) بنرجع لـ startDate كأقرب تقدير للأحدث.
  filtered.sort((a, b) => {
    const aTime = a.createdAt || (a.startDate ? new Date(a.startDate).getTime() : 0);
    const bTime = b.createdAt || (b.startDate ? new Date(b.startDate).getTime() : 0);
    return bTime - aTime;
  });

  document.getElementById('total-contracts-count').textContent = db.contracts.length;

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    renderPaginationControls('contracts', 1, 1, 0, 'contracts-table-wrapper', renderContracts);
    return;
  }
  emptyState.classList.add('hidden');

  // IMPROVEMENT #1 (الأداء): ترقيم صفحات للعقود بدل رسمها كلها دفعة واحدة.
  const pageItems = paginate('contracts', filtered, 'contracts-table-wrapper', renderContracts);

  pageItems.forEach(c => {
    const contractInsts = db.installments.filter(inst => inst.contractId === c.id);
    const paidVal = contractInsts.filter(inst => inst.status === 'paid').reduce((sum, inst) => sum + safeNum(inst.amount), 0);
    const totalInstsAmount = contractInsts.reduce((sum, inst) => sum + safeNum(inst.amount), 0);
    const unpaidCount = contractInsts.filter(inst => inst.status !== 'paid').length;

    // FEATURE: بادچ يوضح حالات العقد الخاصة (سداد مبكر / تعثر)، مش موجودة
    // قبل كده خالص في الجدول ده.
    let statusBadgeHtml = '';
    if (c.status === 'settled_early') {
      statusBadgeHtml = `<span class="badge bg-teal-100 text-teal-700 mr-1 text-[10px] align-middle">✅ مسدد مبكراً</span>`;
    } else if (c.status === 'defaulted') {
      statusBadgeHtml = `<span class="badge bg-rose-100 text-rose-700 mr-1 text-[10px] align-middle">⚠️ متعثر (تم الاسترجاع)</span>`;
    } else if (c.status === 'upgraded') {
      statusBadgeHtml = `<span class="badge bg-violet-100 text-violet-700 mr-1 text-[10px] align-middle">⬆️ تم ترقيته لجهاز جديد</span>`;
    }

    const isSettleable = unpaidCount > 0 && c.status !== 'settled_early' && c.status !== 'defaulted' && c.status !== 'upgraded';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-colors text-xs sm:text-sm';
    tr.innerHTML = `
      <td class="p-4 font-bold text-slate-700 font-mono">${escapeHTML(c.id.replace('con-', ''))}</td>
      <td class="p-4 font-bold text-slate-800">${escapeHTML(c.clientName)} ${statusBadgeHtml}</td>
      <td class="p-4 font-mono text-slate-500">${escapeHTML(c.clientPhone)}</td>
      <td class="p-4 font-semibold text-slate-600">${escapeHTML(c.collectorName) || 'غير مسند'}</td>
      <td class="p-4 text-slate-600">${escapeHTML(c.deviceInfo)}</td>
      <td class="p-4 font-bold font-mono text-slate-800">${c.totalValue.toLocaleString()} ج.م</td>
      <td class="p-4 font-bold font-mono text-teal-600">${c.monthlyInstallment.toLocaleString()} ج.م</td>
      <td class="p-4 font-mono text-xs text-slate-500">${c.startDate}</td>
      <td class="p-4">
        <div class="flex flex-col gap-1">
          <span class="font-bold font-mono text-xs text-slate-700">${paidVal.toLocaleString()} / ${totalInstsAmount.toLocaleString()} ج.م</span>
          <div class="w-24 bg-slate-100 rounded-full h-1 overflow-hidden">
            <div class="bg-teal-600 h-1" style="width: ${(paidVal/totalInstsAmount * 100) || 0}%"></div>
          </div>
        </div>
      </td>
      <td class="p-4 text-center">
         <div class="inline-flex gap-1.5 flex-wrap justify-center">
           <button onclick="viewContractDetails('${c.id}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-semibold transition-all">التفاصيل</button>
           <button onclick="printFormalContract('${c.id}')" title="طباعة العقد الرسمي" class="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md text-xs font-semibold flex items-center gap-1"><i class="ph ph-file-text"></i></button>
           <button onclick="editContract('${c.id}')" class="px-2 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-md text-xs font-semibold flex items-center gap-1"><i class="ph ph-pencil-simple"></i></button>
           ${isSettleable ? `<button onclick="openEarlySettlementModal('${c.id}')" title="سداد مبكر" class="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-md text-xs font-semibold flex items-center gap-1"><i class="ph ph-hand-coins"></i></button>` : ''}
           ${isSettleable ? `<button onclick="openRepossessModal('${c.id}')" title="استرجاع الجهاز (تعثر)" class="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-md text-xs font-semibold flex items-center gap-1"><i class="ph ph-arrow-u-down-left"></i></button>` : ''}
           ${isSettleable ? `<button onclick="openUpgradeContractModal('${c.id}')" title="ترقية الجهاز" class="px-2 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-md text-xs font-semibold flex items-center gap-1"><i class="ph ph-arrow-fat-line-up"></i></button>` : ''}
           <button onclick="deleteContract('${c.id}')" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-md text-xs font-semibold flex items-center gap-1"><i class="ph ph-trash"></i></button>
         </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// --- 5. COLLECTIONS ---
function renderCollections() {
  const searchVal = document.getElementById('collection-search-input').value.toLowerCase();
  const monthFilter = document.getElementById('collection-filter-month').value;
  const statusFilter = document.getElementById('collection-filter-status').value;
  const cardsList = document.getElementById('collections-cards-list');
  const emptyState = document.getElementById('collections-empty-state');
  
  cardsList.innerHTML = '';
  
  const filteredInstallments = db.installments.filter(inst => {
    const matchesSearch = (inst.clientName || '').toLowerCase().includes(searchVal) || (inst.clientPhone || '').includes(searchVal) || (inst.contractId || '').includes(searchVal);
    const instMonth = inst.dueDate.substring(0, 7);
    const matchesMonth = monthFilter === 'all' ? true : instMonth === monthFilter;
    
    const statusInfo = getInstallmentOverdueStatus(inst);
    let matchesStatus = true;
    if (statusFilter === 'paid') {
      matchesStatus = inst.status === 'paid';
    } else if (statusFilter === 'overdue') {
      matchesStatus = inst.status !== 'paid' && statusInfo.overdueDays > 0;
    } else if (statusFilter === 'pending') {
      matchesStatus = inst.status !== 'paid' && statusInfo.overdueDays === 0;
    }
    
    return matchesSearch && matchesMonth && matchesStatus;
  });

  if (filteredInstallments.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const groupedByClient = {};
  filteredInstallments.forEach(inst => {
    const contract = db.contracts.find(c => c.id === inst.contractId);
    const clientId = contract?.clientId || 'unknown';
    if (!groupedByClient[clientId]) {
      groupedByClient[clientId] = {
        clientId: clientId,
        clientName: inst.clientName,
        clientPhone: inst.clientPhone,
        guarantorName: inst.guarantorName,
        guarantorPhone: inst.guarantorPhone,
        installments: []
      };
    }
    groupedByClient[clientId].installments.push(inst);
  });

  // ترتيب أقساط كل عميل: أولاً حسب العقد/الجهاز، ثم حسب رقم القسط تصاعدياً
  // (بدون هذا الترتيب كانت الأقساط بتظهر بترتيب إضافتها الأصلي في قاعدة البيانات
  // مش بترتيبها المنطقي، فيظهر مثلاً قسط 1 ثم قسط 10 ثم قسط 11 قبل قسط 2).
  Object.values(groupedByClient).forEach(clientGroup => {
    clientGroup.installments.sort((a, b) => {
      if (a.contractId !== b.contractId) return a.contractId.localeCompare(b.contractId);
      return (a.installmentNum || 0) - (b.installmentNum || 0);
    });
  });

  Object.values(groupedByClient).forEach(clientGroup => {
    const client = db.clients.find(c => c.id === clientGroup.clientId);
    const totalRemaining = clientGroup.installments.filter(i => i.status !== 'paid').reduce((sum, i) => {
      const stats = getInstallmentOverdueStatus(i);
      return sum + safeNum(stats.totalDue);
    }, 0);
    const totalInsts = clientGroup.installments.length;
    const paidCount = clientGroup.installments.filter(i => i.status === 'paid').length;
    
    const isExpanded = expandedClients.has(clientGroup.clientId);
    
    const clientCard = document.createElement('div');
    clientCard.className = 'glass-card rounded-2xl overflow-hidden transition-all duration-200';
    
    clientCard.innerHTML = `
      <div onclick="toggleClientInstallments('${clientGroup.clientId}')" class="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors select-none">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-sm">
            <i class="ph ${isExpanded ? 'ph-folder-open' : 'ph-folder'} text-lg"></i>
          </div>
          <div>
            <h4 class="font-bold text-slate-800 text-md">${escapeHTML(clientGroup.clientName)}</h4>
            <p class="text-xs text-slate-400 font-mono mt-0.5">${escapeHTML(client?.address) || 'البحيرة'} | هاتف: ${escapeHTML(clientGroup.clientPhone)}</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-4 text-xs font-semibold">
          <div class="text-slate-500">
            الضامن: <span class="font-bold text-slate-700">${escapeHTML(clientGroup.guarantorName) || 'لا يوجد'}</span> 
            ${clientGroup.guarantorPhone ? `<span class="font-mono font-medium text-slate-500">(${escapeHTML(clientGroup.guarantorPhone)})</span>` : ''}
          </div>
          <div class="bg-teal-50 text-teal-700 py-1.5 px-3 rounded-lg">
            إجمالي المستحق حالياً: <span class="font-black text-sm">${totalRemaining.toLocaleString()} ج.م</span>
          </div>
          <div class="bg-slate-100 text-slate-700 py-1.5 px-2.5 rounded-lg font-mono">
            الأقساط المنجزة: ${paidCount} / ${totalInsts}
          </div>
          <button onclick="event.stopPropagation(); openClientFollowUpModal('${clientGroup.clientId}')" class="bg-amber-50 hover:bg-amber-100 text-amber-700 py-1.5 px-2.5 rounded-lg font-semibold flex items-center gap-1"><i class="ph ph-chat-text"></i> متابعة</button>
          <i class="ph ${isExpanded ? 'ph-caret-up' : 'ph-caret-down'} text-slate-400 text-sm ml-2"></i>
        </div>
      </div>

      <div class="${isExpanded ? '' : 'hidden'} border-t border-slate-100 p-4 space-y-3">
        <div class="overflow-x-auto">
          <table class="w-full text-right border-collapse text-xs">
            <thead>
              <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                <th class="p-2.5">رقم الدفعة</th>
                <th class="p-2.5">الجهاز</th>
                <th class="p-2.5">تاريخ الاستحقاق</th>
                <th class="p-2.5">القسط الأساسي</th>
                <th class="p-2.5">الحالة والتأخير</th>
                <th class="p-2.5">المحصل المسند</th>
                <th class="p-2.5">المبلغ المطلوب</th>
                <th class="p-2.5 text-center">إجراءات المراسلة والتواصل</th>
                <th class="p-2.5 text-center">التحصيل</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700">
              ${clientGroup.installments.map(inst => {
                const statusInfo = getInstallmentOverdueStatus(inst);
                const instContract = db.contracts.find(c => c.id === inst.contractId);
                
                let collectorOptions = db.users
                  .filter(u => u.role === 'COLLECTOR')
                  .map(u => `<option value="${escapeHTML(u.name)}" ${inst.collectorName === u.name ? 'selected' : ''}>${escapeHTML(u.name)}</option>`)
                  .join('');

                const isCollectorDisabled = currentUser && currentUser.role === 'COLLECTOR' ? 'disabled class="form-input text-[11px] py-0.5 px-1 border-slate-200 bg-slate-50 cursor-not-allowed"' : 'class="form-input text-[11px] py-0.5 px-1 border-slate-200 bg-white"';

                return `
                  <tr>
                    <td class="p-2.5 font-bold">قسط ${inst.installmentNum}</td>
                    <td class="p-2.5 text-slate-600">${escapeHTML(instContract?.deviceInfo) || '—'}</td>
                    <td class="p-2.5 font-mono text-slate-500">${inst.dueDate}</td>
                    <td class="p-2.5 font-mono font-bold">${inst.amount.toLocaleString()} ج.م</td>
                    <td class="p-2.5"><span class="badge ${statusInfo.statusColor} font-bold">${statusInfo.statusText}</span></td>
                    <td class="p-2.5">
                      <select onchange="updateCollectorForInstallment('${inst.id}', this.value)" ${isCollectorDisabled}>
                        ${collectorOptions}
                      </select>
                    </td>
                    <td class="p-2.5 font-mono font-bold text-teal-600">
                      ${statusInfo.totalDue.toLocaleString()} ج.م
                      ${statusInfo.fine > 0 ? `<span class="text-[9px] text-red-500 block">(غرامة ${statusInfo.fine.toLocaleString()})</span>` : ''}
                    </td>
                    <td class="p-2.5 text-center">
                      <div class="inline-flex gap-1 justify-center">
                        <button onclick="openWhatsappModal('${inst.id}', 'reminder')" class="px-2 py-1 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded text-[10px] font-bold transition-all"><i class="ph ph-bell"></i> تذكير</button>
                        <button onclick="openWhatsappModal('${inst.id}', 'warning_client')" class="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded text-[10px] font-bold transition-all"><i class="ph ph-warning"></i> إنذار</button>
                        <button onclick="openWhatsappModal('${inst.id}', 'receipt')" class="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-[10px] font-bold transition-all"><i class="ph ph-check-circle"></i> رسالة السداد</button>
                      </div>
                    </td>
                    <td class="p-2.5 text-center">
                      ${inst.status !== 'paid' ? `
                        <button onclick="collectInstallmentBtn('${inst.id}')" class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-bold text-[10px] transition-all"><i class="ph ph-check-square"></i> تحصيل</button>
                      ` : `
                        <div class="inline-flex items-center gap-1">
                          <span class="text-emerald-600 font-bold text-[10px]"><i class="ph ph-check mr-0.5"></i> معتمد</span>
                          <button onclick="printInstallmentReceipt('${inst.id}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-bold text-[10px] transition-all"><i class="ph ph-printer"></i> إيصال</button>
                        </div>
                      `}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    cardsList.appendChild(clientCard);
  });
}

window.toggleClientInstallments = function(clientId) {
  if (expandedClients.has(clientId)) {
    expandedClients.delete(clientId);
  } else {
    expandedClients.add(clientId);
  }
  renderCollections();
};

window.updateCollectorForInstallment = async function(instId, collectorName) {
  const inst = db.installments.find(i => i.id === instId);
  if (inst) {
    inst.collectorName = collectorName;
    logAction('تعديل محصل', `تعديل المحصل المسند للقسط رقم ${inst.installmentNum} لعقد ${inst.contractId.replace('con-', '')} إلى ${collectorName}`);
    renderCollections();
    await syncWithAppsScript('updateInstallment', inst);
  }
};

// --- 6. TREASURY & ACCOUNTS ---
function renderTreasury() {
  const tbody = document.getElementById('treasury-transactions-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  if (!tbody) return;
  tbody.innerHTML = '';

  const mainBalance = db.treasuryTransactions.reduce((sum, tx) => sum + safeAmount(tx), 0);
  const pendingCustody = db.collectorCustodies.filter(c => c.status === 'pending').reduce((sum, c) => sum + safeAmount(c), 0);

  document.getElementById('treasury-balance-card').textContent = `${mainBalance.toLocaleString()} ج.م`;
  document.getElementById('treasury-pending-custody').textContent = `${pendingCustody.toLocaleString()} ج.م`;

  const approvalsBody = document.getElementById('collector-approvals-table-body');
  const approvalsEmpty = document.getElementById('collector-approvals-empty');
  approvalsBody.innerHTML = '';
  
  const pendingApprovals = db.collectorCustodies.filter(c => c.status === 'pending');
  
  if (pendingApprovals.length === 0) {
    approvalsEmpty.classList.remove('hidden');
  } else {
    approvalsEmpty.classList.add('hidden');
    pendingApprovals.forEach(app => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition-colors';
      tr.innerHTML = `
        <td class="p-3 font-bold text-slate-800">${escapeHTML(app.collectorName)}</td>
        <td class="p-3 font-semibold text-slate-700">${escapeHTML(app.clientName)}</td>
        <td class="p-3 font-mono">${escapeHTML(app.contractId.replace('con-', ''))}</td>
        <td class="p-3 font-bold font-mono text-teal-600">${app.amount.toLocaleString()} ج.م</td>
        <td class="p-3 text-slate-500 font-mono text-[10px]">${app.date}</td>
        <td class="p-3 text-center">
          <div class="inline-flex gap-2">
            <button onclick="approveCollectorCustody('${app.id}')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow transition-all flex items-center gap-1"><i class="ph ph-check"></i> اعتماد وتأكيد</button>
            <button onclick="rejectCollectorCustody('${app.id}')" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded text-xs font-semibold transition-all"><i class="ph ph-trash"></i></button>
          </div>
        </td>
      `;
      approvalsBody.appendChild(tr);
    });
  }

  sortByTimestampDesc(db.treasuryTransactions).forEach(tx => {
    let typeText = '';
    let typeClass = '';
    let amountSign = '+';
    let amountClass = 'text-emerald-600';
    
    if (tx.type === 'deposit') {
      typeText = 'إيداع / رأس مال';
      typeClass = 'badge-success';
    } else if (tx.type === 'expense') {
      typeText = 'مصروفات خارجية';
      typeClass = 'badge-danger';
      amountSign = '-';
      amountClass = 'text-rose-600';
    } else if (tx.type === 'collection') {
      typeText = 'تحصيل أقساط';
      typeClass = 'badge-info';
    } else if (tx.type === 'cash_sale') {
      typeText = 'بيع كاش فوري';
      typeClass = 'badge-success';
    } else if (tx.type === 'inventory_purchase') {
      typeText = 'شراء بضاعة ومخزون';
      typeClass = 'badge-danger';
      amountSign = '-';
      amountClass = 'text-rose-600';
    } else if (tx.type === 'product_purchase') {
      typeText = 'شراء منتجات (أصناف عامة)';
      typeClass = 'badge-danger';
      amountSign = '-';
      amountClass = 'text-rose-600';
    } else if (tx.type === 'product_sale') {
      typeText = 'بيع منتج (صنف عام)';
      typeClass = 'badge-success';
    } else if (tx.type === 'supplier_payment') {
      typeText = 'سداد دفعة لمورد';
      typeClass = 'badge-danger';
      amountSign = '-';
      amountClass = 'text-rose-600';
    } else if (tx.type === 'capital_injection') {
      typeText = 'ضخ رأس مال (مستثمر)';
      typeClass = 'badge-info';
    } else if (tx.type === 'profit_withdrawal') {
      typeText = 'سحب أرباح (مستثمر)';
      typeClass = 'badge-warning';
      amountSign = '-';
      amountClass = 'text-rose-600';
    } else if (tx.type === 'capital_withdrawal') {
      typeText = 'سحب رأس مال (مستثمر)';
      typeClass = 'badge-warning';
      amountSign = '-';
      amountClass = 'text-rose-600';
    }

    const adminActionBtns = isAdmin() ? `
      <button onclick="editTransaction('${tx.id}')" class="p-1 text-teal-400 hover:text-teal-600 rounded transition-colors" title="تعديل"><i class="ph ph-pencil-simple"></i></button>
      <button onclick="deleteTransaction('${tx.id}')" class="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors" title="حذف"><i class="ph ph-trash"></i></button>
    ` : '';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-colors';
    tr.innerHTML = `
      <td class="p-4 font-mono text-xs text-slate-500">${tx.timestamp}</td>
      <td class="p-4"><span class="badge ${typeClass}">${typeText}</span></td>
      <td class="p-4 text-slate-700 font-medium">${escapeHTML(tx.notes)}</td>
      <td class="p-4 font-bold font-mono ${amountClass}">${amountSign}${Math.abs(tx.amount).toLocaleString()} ج.م</td>
      <td class="p-4 text-center">
        <div class="inline-flex gap-1">${adminActionBtns}</div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ================= 7. INVESTORS & COMPANY CAPITAL (المستثمرون ورأس المال) =================
// المنطق المحاسبي: بنحسب "إجمالي أصول الشركة" الحالية (كاش + بضاعة متاحة + أقساط
// متبقية على العملاء + عهد محصلين معلقة)، وبعدين صافي الربح التراكمي = الأصول
// الحالية ناقص إجمالي رأس المال المستثمَر، زائد أي أرباح اتسحبت فعلاً قبل كده
// (عشان نرجعها للحساب لأنها كانت أرباح مكتسبة).
//
// توزيع الربح بالوقت (Time-Weighted / رأس مال × أيام):
// بدل ما نوزع كل صافي الربح التراكمي بنسبة رأس المال *الحالية* (وده كان بيدي
// أي مستثمر جديد نصيب من أرباح اتحققت قبل ما يدخل أصلاً)، بقينا نقسم الخط
// الزمني لفترات: كل "تجميد أرباح" (Snapshot) بيقفل فترة ويثبّت نصيب كل مستثمر
// فيها. الفترة المفتوحة الحالية (من آخر تجميد لحد النهارده، أو من أول تاريخ
// انضمام مستثمر لو مفيش تجميد خالص) بيتوزع ربحها على المستثمرين اللي كانوا
// موجودين فيها فقط، وبنسبة "رأس ماله × عدد الأيام اللي فضل بيها" وقت الفترة
// دي (مش رأس ماله اللحظي)، عشان مين ما دخل يشارك بس في الربح اللي اتحقق بعد
// دخوله فعلاً.
//
// نصيب المستثمر الكلي = نصيبه المجمّد من الفترات القديمة (لو موجودة) + نصيبه
// من الفترة المفتوحة الحالية.
//
// أصحاب "نسبة شراكة ثابتة" (fixedSharePercent) متفق عليها بعقد مستقل عن رأس
// المال بياخدوا نسبتهم الثابتة من ربح كل فترة (مش محسوبة بالأيام لأنها اتفاق
// تعاقدي بغض النظر عن التوقيت)، والباقي (100% ناقص مجموع النسب الثابتة)
// بيتوزع على باقي المستثمرين حسب رأس مال-أيام كل واحد فيهم من إجمالي رأس
// مال-أيام هذه المجموعة فقط.
function parseDateSafe(str) {
  if (!str) return null;
  const d = new Date(String(str).trim().replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

// إرجاع الخط الزمني لحركات رأس مال مستثمر معين (ضخ/سحب) مرتبة تصاعدياً بالتاريخ.
// أول حركة (الضخ الابتدائي وقت إنشاء المستثمر) بناخد تاريخها الفعلي من
// "تاريخ الانضمام" المُدخل يدوياً (لو موجود) بدل تاريخ تسجيل الحركة في
// النظام، عشان لو الأدمن سجّل مستثمر بأثر رجعي يتحسب من تاريخ دخوله الحقيقي.
function getInvestorCapitalTimeline(investorId, investor) {
  const txs = (db.treasuryTransactions || [])
    .filter(tx => tx.investorId === investorId && (tx.type === 'capital_injection' || tx.type === 'capital_withdrawal'))
    .slice()
    .sort((a, b) => (parseDateSafe(a.timestamp) || 0) - (parseDateSafe(b.timestamp) || 0));

  return txs.map((tx, idx) => {
    let effectiveDate = parseDateSafe(tx.timestamp);
    if (idx === 0 && investor && investor.joinDate) {
      const jd = parseDateSafe(investor.joinDate);
      if (jd) effectiveDate = jd;
    }
    return { date: effectiveDate, amount: safeNum(tx.amount) };
  }).filter(e => e.date);
}

// أقرب تاريخ انضمام بين كل المستثمرين (بيُستخدم كبداية الفترة المفتوحة الأولى
// لو لسه معملناش أي تجميد أرباح خالص).
function getEarliestInvestorDate(investors) {
  let earliest = null;
  (investors || []).forEach(inv => {
    const d = parseDateSafe(inv.joinDate);
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  return earliest || new Date();
}

// حساب "رأس مال × أيام" لمستثمر معين خلال فترة [periodStart, periodEnd]:
// بنمشي على الخط الزمني بتاعه ونجمع (الرصيد الفعلي وقتها × عدد الأيام) لكل
// فترة فرعية فيها الرصيد ثابت.
function computeCapitalDays(timeline, periodStart, periodEnd) {
  if (!periodStart || !periodEnd || !(periodEnd > periodStart)) return 0;

  let balance = timeline.filter(e => e.date <= periodStart).reduce((s, e) => s + e.amount, 0);
  const events = timeline.filter(e => e.date > periodStart && e.date <= periodEnd);

  let cursor = periodStart;
  let capitalDays = 0;
  events.forEach(ev => {
    const days = (ev.date - cursor) / 86400000;
    capitalDays += Math.max(0, balance) * days;
    balance += ev.amount;
    cursor = ev.date;
  });
  const remainingDays = (periodEnd - cursor) / 86400000;
  capitalDays += Math.max(0, balance) * remainingDays;
  return capitalDays;
}

// ================= FEATURE: صافي الربح "المُحقَّق" فقط (بدون أي شيء وهمي) =================
// طلب صريح من صاحب النظام: الربح المعروض للمستثمرين لازم يطلع بس من عمليات
// بيع فعلية حصلت، مش من فرق بين "كل أصول الشركة" و"رأس المال" (الطريقة
// القديمة). المشكلة في الطريقة القديمة كانت بتظهر في حالتين:
//  ١. شراء جهاز بالآجل من مورد كان بيزوّد "أصول الشركة" (المخزون) فوراً من
//     غير أي التزام يقابله (لسه ما اتدفعش للمورد)، فيظهر وكأنه ربح.
//  ٢. الأقساط اللي لسه ما اتحصلتش كانت بتتحسب بالكامل كأصل/ربح متحقق، رغم
//     إن الفلوس لسه معلقة عند العميل ومحصلتش فعلياً.
//
// الحل: الربح دلوقتي بيتحسب بس من:
//  (أ) بيع كاش فوري (أجهزة أو منتجات عامة): الربح = سعر البيع − تكلفة
//      الشراء، ويتحسب بالكامل فور البيع لأن الفلوس اتقبضت كاملة في اللحظة دي.
//  (ب) بيع بالتقسيط: بنحسب "هامش الربح %" للعقد ككل = (قيمة العقد الكلية −
//      تكلفة الجهاز) ÷ قيمة العقد الكلية، وبعدين الربح المُحقَّق = هامش
//      الربح % × إجمالي المبلغ اللي اتحصّل فعلياً من العميل لحد النهاردة
//      (المقدّم + أي قسط اتسدد كامل أو جزئي) - مش قيمة العقد كاملة. يعني كل
//      ما العميل يسدد أكتر، الربح المُحقَّق يزيد تدريجياً معاه، بدل ما يظهر
//      دفعة واحدة يوم توقيع العقد وهو لسه محصلش حاجة.
// وفي الآخر بننزل من إجمالي الربح ده كل المصروفات التشغيلية الفعلية.
function findDeviceCostPriceById(deviceId) {
  if (!deviceId) return 0;
  const dev = db.inventory.find(d => d.id === deviceId);
  return dev ? safeNum(dev.costPrice) : 0;
}

// بيانات قديمة اتسجلت قبل ما نبدأ نحفظ costPrice مباشرة على حركة البيع
// نفسها - كحل احتياطي بس، بنحاول نستخرج السيريال من نص الملاحظات (SN: ...)
// ونطابقه بجهاز في المخزون عشان نجيب تكلفته. لو فشلنا، التكلفة بتتحسب صفر
// (يعني هامش الربح المحسوب لعمليات قديمة زي دي ممكن يكون أعلى شوية من
// الحقيقي، وده أفضل بكتير من الوضع القديم اللي كان بيدّي أرقام وهمية أصلاً).
function resolveLegacyCashSaleCostPrice(tx) {
  const match = (tx.notes || '').match(/SN:\s*([^)]+)\)/);
  if (!match) return 0;
  const serial = match[1].trim();
  const dev = db.inventory.find(d => d.serial === serial);
  return dev ? safeNum(dev.costPrice) : 0;
}

function computeRealizedSalesProfit() {
  // (أ.١) بيع أجهزة كاش فوري
  let cashDeviceSalesProfit = 0;
  db.treasuryTransactions.filter(tx => tx.type === 'cash_sale').forEach(tx => {
    const costPrice = tx.costPrice !== undefined ? safeNum(tx.costPrice) : resolveLegacyCashSaleCostPrice(tx);
    cashDeviceSalesProfit += (safeAmount(tx) - costPrice);
  });

  // (أ.٢) بيع منتجات/إكسسوارات عامة كاش
  let productSalesProfit = 0;
  db.treasuryTransactions.filter(tx => tx.type === 'product_sale').forEach(tx => {
    const costPrice = tx.costPrice !== undefined ? safeNum(tx.costPrice) : 0;
    productSalesProfit += (safeAmount(tx) - costPrice);
  });

  // (ب) بيع بالتقسيط - هامش الربح × نسبة المُحصَّل فعلياً من كل عقد
  let installmentsProfit = 0;
  db.contracts.forEach(contract => {
    const totalValue = safeNum(contract.totalValue);
    if (totalValue <= 0) return;
    const costPrice = contract.costPrice !== undefined ? safeNum(contract.costPrice) : findDeviceCostPriceById(contract.deviceId);
    const marginPercent = Math.max(0, totalValue - costPrice) / totalValue;
    const collected = computeContractBalance(contract).totalPaid;
    installmentsProfit += collected * marginPercent;
  });

  const totalSalesProfit = cashDeviceSalesProfit + productSalesProfit + installmentsProfit;
  const totalOperatingExpenses = (db.expenses || []).reduce((sum, e) => sum + safeNum(e.amount), 0);

  return {
    cashDeviceSalesProfit,
    productSalesProfit,
    installmentsProfit,
    totalSalesProfit,
    totalOperatingExpenses,
    netRealizedProfit: totalSalesProfit - totalOperatingExpenses
  };
}

function computeInvestorFinancials() {
  const treasuryBalance = db.treasuryTransactions.reduce((sum, tx) => sum + safeAmount(tx), 0);
  const inventoryCapital = db.inventory.filter(dev => dev.status === 'available' || dev.status === 'maintenance').reduce((sum, dev) => sum + safeNum(dev.costPrice), 0);
  // FIX (تقرير الفحص - بند ٣.١): كان بيتحسب هنا inst.amount الكامل حتى لو
  // كان القسط اتحصّل منه جزء (paidAmount) بالفعل ودخل الخزينة فعلياً، وده
  // كان بيضاعف احتساب نفس المبلغ (مرة في treasuryBalance ومرة تانية هنا)
  // ويضخّم صافي الربح ونصيب المستثمرين وهمياً. دلوقتي بنحسب المتبقي الفعلي
  // فقط (المبلغ - أي جزء اتحصّل منه سابقاً)، مع حماية ضد أي قيمة سالبة.
  const outstandingInstallments = db.installments.filter(inst => inst.status !== 'paid').reduce((sum, inst) => sum + Math.max(0, safeNum(inst.amount) - safeNum(inst.paidAmount)), 0);
  const pendingCustody = db.collectorCustodies.filter(c => c.status === 'pending').reduce((sum, c) => sum + safeAmount(c), 0);

  const totalAssets = treasuryBalance + inventoryCapital + outstandingInstallments + pendingCustody;

  const investors = db.investors || [];
  const totalCapital = investors.reduce((sum, inv) => sum + safeNum(inv.capitalAmount), 0);
  const totalWithdrawn = investors.reduce((sum, inv) => sum + safeNum(inv.totalWithdrawn), 0);

  // FEATURE: الربح دلوقتي = ربح مُحقَّق فقط من مبيعات فعلية (كاش + نسبة
  // المُحصَّل من التقسيط) ناقص المصروفات التشغيلية - راجع تعليق
  // computeRealizedSalesProfit فوق لتفاصيل المنطق الكامل. totalAssets لسه
  // بيتحسب وبيترجع (يُستخدم بس في تقرير خروج/تصفية مستثمر لتوزيع نوع
  // الأصول، مش في حساب الربح نفسه).
  const realizedProfit = computeRealizedSalesProfit();
  const netProfit = realizedProfit.netRealizedProfit;

  // ---- تحديد الفترة المفتوحة الحالية (من آخر تجميد أو من أول انضمام) ----
  const snapshots = (db.investorSnapshots || []).slice().sort((a, b) => (parseDateSafe(a.timestamp) || 0) - (parseDateSafe(b.timestamp) || 0));
  const lastSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;

  const periodStart = lastSnapshot ? parseDateSafe(lastSnapshot.timestamp) : getEarliestInvestorDate(investors);
  const periodEnd = new Date();
  const lockedNetProfit = lastSnapshot ? (lastSnapshot.netProfit || 0) : 0;
  const periodProfit = netProfit - lockedNetProfit;

  const hasFixedShare = (inv) => inv.fixedSharePercent !== undefined && inv.fixedSharePercent !== null && inv.fixedSharePercent !== '' && !isNaN(inv.fixedSharePercent);

  const fixedInvestors = investors.filter(hasFixedShare);
  const variableInvestors = investors.filter(inv => !hasFixedShare(inv));
  const sumFixedPercent = Math.min(100, fixedInvestors.reduce((sum, inv) => sum + safeNum(inv.fixedSharePercent), 0));
  const remainingPoolPercent = 100 - sumFixedPercent;
  const variableCapitalTotal = variableInvestors.reduce((sum, inv) => sum + safeNum(inv.capitalAmount), 0);

  // رأس مال-أيام لكل مستثمر متغير خلال الفترة المفتوحة الحالية
  const capitalDaysByInvestor = {};
  let totalVariableCapitalDays = 0;
  variableInvestors.forEach(inv => {
    const timeline = getInvestorCapitalTimeline(inv.id, inv);
    const cd = computeCapitalDays(timeline, periodStart, periodEnd);
    capitalDaysByInvestor[inv.id] = cd;
    totalVariableCapitalDays += cd;
  });

  const investorsWithShares = investors.map(inv => {
    let sharePercent, periodProfitShare;
    if (hasFixedShare(inv)) {
      sharePercent = Number(inv.fixedSharePercent);
      periodProfitShare = periodProfit * (sharePercent / 100);
    } else {
      // نسبة الملكية المعروضة (لأغراض العرض والرسم البياني) بتفضل بنسبة رأس
      // المال اللحظية من إجمالي رأس المال المتغير. أما توزيع ربح الفترة نفسه
      // فبيعتمد على رأس مال-أيام (أدق وقت دخول/خروج مستثمرين في نفس الفترة).
      sharePercent = variableCapitalTotal > 0 ? (inv.capitalAmount / variableCapitalTotal) * remainingPoolPercent : 0;
      const cd = capitalDaysByInvestor[inv.id] || 0;
      const fraction = totalVariableCapitalDays > 0
        ? (cd / totalVariableCapitalDays)
        : (variableCapitalTotal > 0 ? (inv.capitalAmount / variableCapitalTotal) : 0); // fallback لو الفترة قصيرة جداً بحيث الأيام = صفر
      periodProfitShare = periodProfit * (remainingPoolPercent / 100) * fraction;
    }

    const lockedEntry = lastSnapshot ? (lastSnapshot.perInvestor || []).find(p => p.investorId === inv.id) : null;
    const lockedShare = lockedEntry ? (lockedEntry.profitShare || 0) : 0;

    const profitShare = lockedShare + periodProfitShare;
    const withdrawn = inv.totalWithdrawn || 0;
    const remainingDue = profitShare - withdrawn;
    return { ...inv, sharePercent, profitShare, withdrawn, remainingDue, periodProfitShare, lockedShare };
  });

  return {
    treasuryBalance, inventoryCapital, outstandingInstallments, pendingCustody,
    totalAssets, totalCapital, totalWithdrawn, netProfit, sumFixedPercent,
    realizedProfit,
    periodStart, periodEnd, periodProfit, lastSnapshot,
    investors: investorsWithShares
  };
}

// ================= تقرير خروج/تصفية مستثمر (Exit / Liquidation Report) =================
// لما مستثمر يحب يخرج، محتاجين نوريله: (1) إجمالي المستحق له = رأس ماله +
// نصيبه المتبقي من الأرباح، و(2) تفصيل: قد إيه من المستحق ده متاح كاش فوراً
// من الخزينة، وقد إيه لسه "شغال" في بضاعة لسه ما اتباعتش أو أقساط لسه ما
// اتحصلتش أو عهد محصلين معلقة. بنفترض إن أصول الشركة موزعة بالتناسب على كل
// المستحقات (رأس مال + أرباح مستحقة لكل المستثمرين) عشان نديله تقدير عادل
// لنصيبه من كل نوع أصل.
function computeInvestorExitReport(investorId) {
  const stats = computeInvestorFinancials();
  const inv = stats.investors.find(i => i.id === investorId);
  if (!inv) return null;

  const totalCapitalReturn = inv.capitalAmount || 0;
  const totalDue = totalCapitalReturn + Math.max(0, inv.remainingDue);
  // إجمالي مستحقات كل المستثمرين مجتمعين (رأس المال + الأرباح غير المسحوبة)
  const totalAllInvestorsDue = stats.investors.reduce((sum, i) => sum + safeNum(i.capitalAmount) + Math.max(0, safeNum(i.remainingDue)), 0);

  const fractionOfAssets = totalAllInvestorsDue > 0 ? (totalDue / totalAllInvestorsDue) : 0;

  const cashPortion = stats.treasuryBalance * fractionOfAssets;
  const inventoryPortion = stats.inventoryCapital * fractionOfAssets;
  const installmentsPortion = stats.outstandingInstallments * fractionOfAssets;
  const custodyPortion = stats.pendingCustody * fractionOfAssets;
  const nonLiquidPortion = inventoryPortion + installmentsPortion + custodyPortion;

  return {
    investor: inv,
    periodStart: stats.periodStart,
    periodEnd: stats.periodEnd,
    capitalAmount: totalCapitalReturn,
    profitShare: inv.profitShare,
    withdrawn: inv.withdrawn,
    remainingDue: inv.remainingDue,
    totalDue,
    fractionOfAssets,
    cashPortion,
    inventoryPortion,
    installmentsPortion,
    custodyPortion,
    nonLiquidPortion
  };
}

// إرجاع كل حركات الخزينة الخاصة بمستثمر معين (سجل حركاته الكامل). بنعتمد على
// حقل investorId المُسجَّل في الحركة، ولو الحركة قديمة (اتسجلت قبل إضافة هذا
// الحقل) بنرجع لمطابقة اسم المستثمر داخل نص الملاحظات كحل احتياطي متوافق مع
// البيانات القديمة.
function getInvestorLedgerTransactions(investorId, investorName) {
  return db.treasuryTransactions.filter(tx => {
    if (tx.investorId) return tx.investorId === investorId;
    const relevantTypes = ['capital_injection', 'profit_withdrawal', 'capital_withdrawal'];
    if (!relevantTypes.includes(tx.type)) return false;
    return investorName && tx.notes && tx.notes.includes(investorName);
  }).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

let investorsCapitalChartInstance = null;

// ================= موافقة السحوبات الكبيرة (Withdrawal Approval Queue) =================
function renderPendingWithdrawals() {
  const panel = document.getElementById('pending-withdrawals-panel');
  const listEl = document.getElementById('pending-withdrawals-list');
  if (!panel || !listEl) return;

  const pending = db.pendingWithdrawals.filter(w => w.status === 'pending');
  if (pending.length === 0 || !isAdmin()) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  listEl.innerHTML = pending.map(w => {
    // FEATURE: منع الشخص اللي طلب السحب من موافقة نفسه - لازم أدمن تاني.
    const isSameAdmin = currentUser && w.requestedByUserId === currentUser.id;
    const typeLabel = w.type === 'capital_withdrawal' ? 'سحب رأس مال' : 'سحب أرباح';
    return `
    <div class="p-3 bg-white rounded-xl border border-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div class="text-sm">
        <p class="font-bold text-slate-800">${typeLabel} — ${escapeHTML(w.investorName)}</p>
        <p class="text-xs text-slate-500">${safeNum(w.amount).toLocaleString()} ج.م — طلبها ${escapeHTML(w.requestedBy)} بتاريخ ${escapeHTML(w.timestamp)}</p>
        ${w.notes ? `<p class="text-xs text-slate-400">${escapeHTML(w.notes)}</p>` : ''}
      </div>
      <div class="flex gap-1.5 shrink-0">
        ${isSameAdmin
          ? `<span class="text-[11px] text-amber-600 font-semibold px-2 py-1">⛔ لازم أدمن تاني يوافق</span>`
          : `<button onclick="approvePendingWithdrawal('${w.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold">موافقة</button>
             <button onclick="rejectPendingWithdrawal('${w.id}')" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-semibold">رفض</button>`
        }
      </div>
    </div>
  `;
  }).join('');
}

window.approvePendingWithdrawal = async function(id) {
  await runWithActionLock(`approve-withdrawal-${id}`, async () => {
  const w = db.pendingWithdrawals.find(x => x.id === id);
  if (!w || w.status !== 'pending') return;
  if (currentUser && w.requestedByUserId === currentUser.id) {
    alert('⛔ لازم أدمن تاني (غير اللي طلب السحب) يوافق على الطلب ده.');
    return;
  }
  if (!(await customConfirm(`تأكيد الموافقة على سحب ${safeNum(w.amount).toLocaleString()} ج.م للمستثمر ${w.investorName}؟`))) return;

  const inv = db.investors.find(i => i.id === w.investorId);
  if (!inv) { alert('المستثمر ده مش موجود - ممكن يكون اتحذف.'); return; }

  const txId = `tx-wd-${Date.now()}`;
  if (w.type === 'capital_withdrawal') {
    inv.capitalAmount = Math.max(0, (inv.capitalAmount || 0) - w.amount);
    const withdrawTx = { id: txId, timestamp: nowTimestamp(), type: 'capital_withdrawal', amount: -w.amount, investorId: w.investorId, notes: `سحب رأس مال معتمد (بموافقة إضافية) للمستثمر ${w.investorName}${w.notes ? ': ' + w.notes : ''}` };
    db.treasuryTransactions.unshift(withdrawTx);
    await syncWithAppsScript('withdrawInvestorCapital', { investorId: w.investorId, newCapitalAmount: inv.capitalAmount, transaction: withdrawTx });
  } else {
    inv.totalWithdrawn = (inv.totalWithdrawn || 0) + w.amount;
    const withdrawTx = { id: txId, timestamp: nowTimestamp(), type: 'profit_withdrawal', amount: -w.amount, investorId: w.investorId, notes: `سحب أرباح معتمد (بموافقة إضافية) للمستثمر ${w.investorName}${w.notes ? ': ' + w.notes : ''}` };
    db.treasuryTransactions.unshift(withdrawTx);
    await syncWithAppsScript('withdrawInvestorProfit', { investorId: w.investorId, newTotalWithdrawn: inv.totalWithdrawn, transaction: withdrawTx });
  }

  w.status = 'approved';
  w.approvedBy = currentUser.name;
  await syncWithAppsScript('updatePendingWithdrawal', { id: w.id, status: 'approved', approvedBy: currentUser.name });

  logAction('اعتماد سحب معلّق', `اعتماد ${w.type === 'capital_withdrawal' ? 'سحب رأس مال' : 'سحب أرباح'} ${w.amount.toLocaleString()} ج.م للمستثمر ${w.investorName}`);
  renderInvestors();
  renderTreasury();
  renderDashboard();
  updateNotificationBell();
  showToast('✅ تم اعتماد السحب وتنفيذه', 'success');
  });
};

window.rejectPendingWithdrawal = async function(id) {
  await runWithActionLock(`reject-withdrawal-${id}`, async () => {
  const w = db.pendingWithdrawals.find(x => x.id === id);
  if (!w || w.status !== 'pending') return;
  if (currentUser && w.requestedByUserId === currentUser.id) {
    alert('⛔ لازم أدمن تاني (غير اللي طلب السحب) يرفض الطلب ده.');
    return;
  }
  if (!(await customConfirm('هل أنت متأكد من رفض طلب السحب ده؟'))) return;

  w.status = 'rejected';
  await syncWithAppsScript('updatePendingWithdrawal', { id: w.id, status: 'rejected', rejectedBy: currentUser.name });

  logAction('رفض سحب معلّق', `رفض ${w.type === 'capital_withdrawal' ? 'سحب رأس مال' : 'سحب أرباح'} ${w.amount.toLocaleString()} ج.م للمستثمر ${w.investorName}`);
  renderPendingWithdrawals();
  updateNotificationBell();
  showToast('تم رفض طلب السحب', 'success');
  });
};

function renderInvestors() {
  const tbody = document.getElementById('investors-table-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  if (!tbody) return;
  renderPendingWithdrawals();

  const stats = computeInvestorFinancials();
  const admin = isAdmin();

  document.getElementById('investors-total-capital').textContent = `${stats.totalCapital.toLocaleString()} ج.م`;
  document.getElementById('investors-total-assets').textContent = `${stats.totalAssets.toLocaleString()} ج.م`;
  document.getElementById('investors-net-profit').textContent = `${Math.round(stats.netProfit).toLocaleString()} ج.م`;
  document.getElementById('investors-total-withdrawn').textContent = `${stats.totalWithdrawn.toLocaleString()} ج.م`;

  const netProfitEl = document.getElementById('investors-net-profit');
  netProfitEl.className = stats.netProfit >= 0 ? 'text-base sm:text-3xl font-extrabold mt-1.5 sm:mt-3 text-emerald-400 truncate' : 'text-base sm:text-3xl font-extrabold mt-1.5 sm:mt-3 text-rose-400 truncate';

  // FEATURE: تعبئة لوحة "من أين جاء هذا الربح؟" بالأرقام الفعلية
  if (stats.realizedProfit) {
    const rp = stats.realizedProfit;
    document.getElementById('profit-breakdown-cash-device').textContent = `${Math.round(rp.cashDeviceSalesProfit).toLocaleString()} ج.م`;
    document.getElementById('profit-breakdown-product').textContent = `${Math.round(rp.productSalesProfit).toLocaleString()} ج.م`;
    document.getElementById('profit-breakdown-installments').textContent = `${Math.round(rp.installmentsProfit).toLocaleString()} ج.م`;
    document.getElementById('profit-breakdown-expenses').textContent = `-${Math.round(rp.totalOperatingExpenses).toLocaleString()} ج.م`;
  }

  // أزرار إدارة المستثمرين (إضافة/تجميد الأرباح) للأدمن فقط - أي موظف عنده
  // صلاحية عرض هذا التبويب هيقدر يشوف البيانات ويطبع كشوف الحساب، لكن مش
  // هيقدر يضيف مستثمر جديد أو يجمّد الأرباح أو يعدّل رأس المال.
  const adminToolbar = document.getElementById('investors-admin-toolbar');
  if (adminToolbar) adminToolbar.classList.toggle('hidden', !admin);

  // FEATURE: تحذير لمرة واحدة للأدمن لو فيه تجميدات قديمة اتعملت بالطريقة
  // المحاسبية القديمة (أصول الشركة) قبل التحويل لطريقة "الربح المُحقَّق من
  // مبيعات فعلية بس". لازم الأدمن يراجع ويعمل تجميد جديد عشان "ربح الفترة
  // الحالية" ميطلعش رقم غريب (لأنه هيقارن Netprofit بالطريقة الجديدة بآخر
  // Netprofit كان محسوب بالطريقة القديمة).
  const migrationBanner = document.getElementById('profit-method-migration-banner');
  if (migrationBanner) {
    const hasLegacySnapshot = (db.investorSnapshots || []).some(s => s.computationMethod !== 'realized-sales-v1');
    migrationBanner.classList.toggle('hidden', !hasLegacySnapshot || !admin);
  }

  tbody.innerHTML = '';
  const emptyState = document.getElementById('investors-empty-state');

  if (!stats.investors || stats.investors.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    stats.investors.forEach(inv => {
      const readOnlyBtns = `
        <button onclick="viewInvestorLedger('${inv.id}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold transition-all flex items-center gap-1" title="سجل حركاته"><i class="ph ph-list-bullets"></i> السجل</button>
        <button onclick="printInvestorStatement('${inv.id}')" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-semibold transition-all flex items-center gap-1" title="طباعة كشف حساب"><i class="ph ph-printer"></i> كشف حساب</button>
        <button onclick="viewInvestorExitReport('${inv.id}')" class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-xs font-semibold transition-all flex items-center gap-1" title="تقرير خروج / تصفية"><i class="ph ph-door-open"></i> تقرير خروج</button>
      `;
      const adminActionBtns = admin ? `
        <button onclick="openEditInvestorModal('${inv.id}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs font-semibold transition-all flex items-center gap-1" title="تعديل البيانات"><i class="ph ph-pencil-simple"></i> تعديل</button>
        <button onclick="openAddCapitalModal('${inv.id}')" class="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-600 rounded text-xs font-semibold transition-all flex items-center gap-1" title="إضافة رأس مال"><i class="ph ph-plus-circle"></i> رأس مال</button>
        <button onclick="openWithdrawCapitalModal('${inv.id}')" class="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded text-xs font-semibold transition-all flex items-center gap-1" title="سحب رأس مال"><i class="ph ph-minus-circle"></i> سحب رأس مال</button>
        <button onclick="openWithdrawProfitModal('${inv.id}')" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-xs font-semibold transition-all flex items-center gap-1" title="سحب أرباح"><i class="ph ph-hand-withdraw"></i> سحب أرباح</button>
        <button onclick="deleteInvestor('${inv.id}')" class="p-1.5 text-slate-400 hover:text-rose-500 rounded transition-colors" title="حذف"><i class="ph ph-trash"></i></button>
      ` : '';

      const remainingClass = inv.remainingDue >= 0 ? 'text-emerald-600' : 'text-rose-600';
      const hasFixed = inv.fixedSharePercent !== undefined && inv.fixedSharePercent !== null && inv.fixedSharePercent !== '' && !isNaN(inv.fixedSharePercent);
      const fixedBadge = hasFixed ? `<span class="inline-block mr-1 px-1.5 py-0.5 bg-violet-50 text-violet-600 border border-violet-100 rounded text-[10px] font-bold align-middle" title="نسبة شراكة ثابتة بالاتفاق، مش محسوبة من رأس المال">ثابتة</span>` : '';

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-50 transition-colors';
      tr.innerHTML = `
        <td class="p-4 font-bold text-slate-800">${escapeHTML(inv.name)}${inv.notes ? `<div class="text-[11px] font-normal text-slate-400 mt-0.5">${escapeHTML(inv.notes)}</div>` : ''}</td>
        <td class="p-4 text-slate-500 font-mono text-xs">${escapeHTML(inv.joinDate) || '-'}</td>
        <td class="p-4 font-bold font-mono text-teal-600">${(inv.capitalAmount || 0).toLocaleString()} ج.م</td>
        <td class="p-4 font-mono">${inv.sharePercent.toFixed(1)}%${fixedBadge}</td>
        <td class="p-4 font-bold font-mono ${inv.profitShare >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${Math.round(inv.profitShare).toLocaleString()} ج.م</td>
        <td class="p-4 font-mono text-slate-600">${inv.withdrawn.toLocaleString()} ج.م</td>
        <td class="p-4 font-bold font-mono ${remainingClass}">${Math.round(inv.remainingDue).toLocaleString()} ج.م</td>
        <td class="p-4 text-center">
          <div class="inline-flex flex-wrap gap-1.5 justify-center">${readOnlyBtns}${adminActionBtns}</div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderInvestorsCapitalChart(stats);
}

// رسم بياني (Doughnut) صغير ومضغوط لتوزيع رأس المال المستثمَر بين المستثمرين،
// مع قائمة (Legend) مخصصة جنب الرسم بدل الأسفل عشان تاخد مساحة أقل وتفيد أكتر.
function renderInvestorsCapitalChart(stats) {
  const canvas = document.getElementById('investors-capital-chart');
  const emptyMsg = document.getElementById('investors-chart-empty');
  const legendBox = document.getElementById('investors-chart-legend');
  if (!canvas) return;

  if (investorsCapitalChartInstance) {
    investorsCapitalChartInstance.destroy();
    investorsCapitalChartInstance = null;
  }

  const investors = (stats.investors || []).filter(inv => (inv.capitalAmount || 0) > 0);
  if (investors.length === 0 || typeof Chart === 'undefined') {
    canvas.classList.add('hidden');
    if (emptyMsg) emptyMsg.classList.remove('hidden');
    if (legendBox) legendBox.innerHTML = '';
    return;
  }
  canvas.classList.remove('hidden');
  if (emptyMsg) emptyMsg.classList.add('hidden');

  const palette = ['#0071e3', '#0ea5e9', '#f59e0b', '#f43f5e', '#8b5cf6', '#22c55e', '#eab308', '#6366f1', '#ec4899', '#5e5ce6'];
  const ctx = canvas.getContext('2d');
  const isDarkMode = document.documentElement.classList.contains('dark');

  investorsCapitalChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: investors.map(inv => inv.name),
      datasets: [{
        data: investors.map(inv => inv.capitalAmount),
        backgroundColor: investors.map((_, i) => palette[i % palette.length]),
        borderWidth: 2,
        borderColor: isDarkMode ? '#1e293b' : '#ffffff'
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx2) => `${ctx2.label}: ${ctx2.parsed.toLocaleString()} ج.م`
          }
        }
      }
    }
  });

  // Legend مخصصة: نقطة لونية + اسم + نسبة + قيمة، بجانب الرسم مباشرة
  if (legendBox) {
    legendBox.innerHTML = investors.map((inv, i) => {
      const percent = stats.totalCapital > 0 ? (inv.capitalAmount / stats.totalCapital) * 100 : 0;
      return `
        <div class="flex items-center justify-between gap-2 py-1 border-b border-slate-50 last:border-0">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${palette[i % palette.length]}"></span>
            <span class="font-semibold text-slate-700 truncate">${escapeHTML(inv.name)}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0 font-mono text-xs">
            <span class="text-slate-400">${percent.toFixed(1)}%</span>
            <span class="font-bold text-slate-600">${(inv.capitalAmount || 0).toLocaleString()} ج.م</span>
          </div>
        </div>
      `;
    }).join('');
  }
}

function nowTimestamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

window.openAddCapitalModal = function(investorId) {
  const inv = db.investors.find(i => i.id === investorId);
  if (!inv) return;
  document.getElementById('add-capital-investor-id').value = investorId;
  document.getElementById('add-capital-investor-name').textContent = inv.name;
  document.getElementById('add-capital-amount').value = '';
  document.getElementById('add-capital-notes').value = '';
  openModal('add-capital-modal');
};

// سحب جزء من رأس المال ذاته (مش من الأرباح). بيقلل capitalAmount مباشرة، وده
// بيغيّر نسبة ملكية المستثمر تلقائياً في المرة الجاية اللي تتحسب فيها الأرباح.
window.openWithdrawCapitalModal = function(investorId) {
  const inv = db.investors.find(i => i.id === investorId);
  if (!inv) return;
  document.getElementById('withdraw-capital-investor-id').value = investorId;
  document.getElementById('withdraw-capital-investor-name').textContent = inv.name;
  document.getElementById('withdraw-capital-current').textContent = `${(inv.capitalAmount || 0).toLocaleString()} ج.م`;
  document.getElementById('withdraw-capital-amount').value = '';
  document.getElementById('withdraw-capital-notes').value = '';
  openModal('withdraw-capital-modal');
};

window.openWithdrawProfitModal = function(investorId) {
  const stats = computeInvestorFinancials();
  const inv = stats.investors.find(i => i.id === investorId);
  if (!inv) return;
  document.getElementById('withdraw-profit-investor-id').value = investorId;
  document.getElementById('withdraw-profit-investor-name').textContent = inv.name;
  document.getElementById('withdraw-profit-remaining-due').textContent = `${Math.round(inv.remainingDue).toLocaleString()} ج.م`;
  document.getElementById('withdraw-profit-amount').value = '';
  document.getElementById('withdraw-profit-notes').value = '';
  openModal('withdraw-investor-profit-modal');
};

// فتح نافذة تعديل بيانات المستثمر (الاسم/تاريخ الانضمام/الملاحظات/نسبة الشراكة
// الثابتة). لا يمكن تعديل رأس المال من هنا مباشرة حفاظاً على سجل الحركات
// (لازم يتم عبر "إضافة رأس مال" أو "سحب رأس مال" عشان تفضل كل حركة موثقة).
window.openEditInvestorModal = function(investorId) {
  const inv = db.investors.find(i => i.id === investorId);
  if (!inv) return;
  document.getElementById('edit-investor-id').value = investorId;
  document.getElementById('edit-investor-name').value = inv.name || '';
  document.getElementById('edit-investor-join-date').value = inv.joinDate || '';
  document.getElementById('edit-investor-notes').value = inv.notes || '';
  document.getElementById('edit-investor-fixed-share').value = (inv.fixedSharePercent !== undefined && inv.fixedSharePercent !== null) ? inv.fixedSharePercent : '';
  openModal('edit-investor-modal');
};

window.deleteInvestor = async function(investorId) {
  await runWithActionLock(`delete-investor-${investorId}`, async () => {
  const inv = db.investors.find(i => i.id === investorId);
  if (!inv) return;
  if (!(await customConfirm(`هل أنت متأكد من حذف المستثمر "${inv.name}" نهائياً؟\n\nملاحظة: حركات رأس المال والسحب السابقة الخاصة به هتفضل موجودة في سجل الخزينة للأرشفة، لكن مش هتتحسب في توزيع الأرباح تاني بعد الحذف.`))) return;

  db.investors = db.investors.filter(i => i.id !== investorId);
  logAction('حذف مستثمر', `حذف المستثمر ${inv.name} من سجل رأس المال`);
  await syncWithAppsScript('deleteInvestor', { id: investorId });
  renderInvestors();
  });
};

// ================= سجل حركات المستثمر (Ledger) =================
window.viewInvestorLedger = function(investorId) {
  const stats = computeInvestorFinancials();
  const inv = stats.investors.find(i => i.id === investorId);
  if (!inv) return;

  const txs = getInvestorLedgerTransactions(investorId, inv.name);
  const typeLabels = {
    capital_injection: { text: 'ضخ رأس مال', color: 'text-teal-600' },
    capital_withdrawal: { text: 'سحب رأس مال', color: 'text-amber-600' },
    profit_withdrawal: { text: 'سحب أرباح', color: 'text-emerald-600' }
  };

  document.getElementById('investor-ledger-title').textContent = `سجل حركات المستثمر: ${inv.name}`;
  document.getElementById('investor-ledger-summary').innerHTML = `
    <div><span class="text-slate-500">رأس المال الحالي:</span> <strong class="text-teal-600">${(inv.capitalAmount || 0).toLocaleString()} ج.م</strong></div>
    <div><span class="text-slate-500">نصيبه من الربح:</span> <strong class="${inv.profitShare >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${Math.round(inv.profitShare).toLocaleString()} ج.م</strong></div>
    <div><span class="text-slate-500">المسحوب فعلياً (أرباح):</span> <strong>${inv.withdrawn.toLocaleString()} ج.م</strong></div>
    <div><span class="text-slate-500">المتبقي له:</span> <strong class="${inv.remainingDue >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${Math.round(inv.remainingDue).toLocaleString()} ج.م</strong></div>
  `;

  const body = document.getElementById('investor-ledger-body');
  if (txs.length === 0) {
    body.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">لا توجد حركات مسجلة لهذا المستثمر بعد.</div>`;
  } else {
    body.innerHTML = `
      <table class="w-full text-right border-collapse text-sm">
        <thead>
          <tr class="bg-slate-50 border-b border-slate-100 text-slate-600 text-xs font-semibold">
            <th class="p-3">التاريخ</th><th class="p-3">النوع</th><th class="p-3">المبلغ</th><th class="p-3">ملاحظات</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${txs.map(tx => {
            const info = typeLabels[tx.type] || { text: tx.type, color: 'text-slate-600' };
            return `<tr>
              <td class="p-3 font-mono text-xs text-slate-500">${escapeHTML(tx.timestamp)}</td>
              <td class="p-3 font-semibold ${info.color}">${info.text}</td>
              <td class="p-3 font-mono font-bold ${tx.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${tx.amount >= 0 ? '+' : ''}${tx.amount.toLocaleString()} ج.م</td>
              <td class="p-3 text-slate-500 text-xs">${escapeHTML(tx.notes) || '-'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }
  openModal('investor-ledger-modal');
};

// ================= كشف حساب مستثمر قابل للطباعة/الحفظ PDF =================
window.printInvestorStatement = function(investorId) {
  const stats = computeInvestorFinancials();
  const inv = stats.investors.find(i => i.id === investorId);
  if (!inv) return;

  const companyName = db.settings.companyName || 'شركة SKY';
  const txs = getInvestorLedgerTransactions(investorId, inv.name);
  const typeLabels = { capital_injection: 'ضخ رأس مال', capital_withdrawal: 'سحب رأس مال', profit_withdrawal: 'سحب أرباح' };

  const txRows = txs.map(tx => `
    <tr>
      <td>${escapeHTML(tx.timestamp)}</td>
      <td>${typeLabels[tx.type] || tx.type}</td>
      <td>${tx.amount >= 0 ? '+' : ''}${tx.amount.toLocaleString()} ج.م</td>
      <td>${escapeHTML(tx.notes) || '-'}</td>
    </tr>
  `).join('');

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    <div class="print-doc-title">كشف حساب مستثمر</div>

    <div class="print-doc-row"><span>اسم المستثمر</span><strong>${escapeHTML(inv.name)}</strong></div>
    <div class="print-doc-row"><span>تاريخ الانضمام</span><strong>${escapeHTML(inv.joinDate) || '—'}</strong></div>
    <div class="print-doc-row"><span>نسبة الملكية</span><strong>${inv.sharePercent.toFixed(1)}%${(inv.fixedSharePercent !== undefined && inv.fixedSharePercent !== null && inv.fixedSharePercent !== '') ? ' (نسبة ثابتة بالاتفاق)' : ''}</strong></div>

    <div style="margin-top:14px; padding:10px 12px; background:#ecfdf5; border-radius:8px; display:flex; justify-content:space-around; text-align:center; font-size:0.85rem;">
      <div><div style="color:#64748b; font-size:0.7rem;">رأس المال الحالي</div><strong>${(inv.capitalAmount || 0).toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">نصيبه من الربح</div><strong style="color:#059669;">${Math.round(inv.profitShare).toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">المسحوب فعلياً</div><strong style="color:#d97706;">${inv.withdrawn.toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">المتبقي له</div><strong style="color:${inv.remainingDue >= 0 ? '#059669' : '#e11d48'};">${Math.round(inv.remainingDue).toLocaleString()} ج.م</strong></div>
    </div>

    <div style="margin-top:18px;">
      <strong style="font-size:0.9rem;">سجل الحركات</strong>
      <table class="print-doc-table" style="margin-top:8px;">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظات</th></tr></thead>
        <tbody>${txRows || '<tr><td colspan="4" style="text-align:center;">لا توجد حركات مسجلة</td></tr>'}</tbody>
      </table>
    </div>

    <div class="print-doc-signatures">
      <div>توقيع مسؤول الحسابات: ______________</div>
      <div>توقيع المستثمر: ______________</div>
    </div>
    <div class="print-doc-footer">تم إصدار هذا الكشف إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${new Date().toLocaleString('ar-EG')}</div>
  `;

  printHTML(html);
  logAction('طباعة كشف حساب', `طباعة كشف حساب للمستثمر ${inv.name}`);
};

// ================= تقرير خروج / تصفية مستثمر (عرض في مودال) =================
window.viewInvestorExitReport = function(investorId) {
  const report = computeInvestorExitReport(investorId);
  if (!report) return;
  const inv = report.investor;

  const fmt = (n) => Math.round(n).toLocaleString();
  const periodStartText = report.periodStart ? report.periodStart.toLocaleDateString('ar-EG') : '-';
  const periodEndText = report.periodEnd ? report.periodEnd.toLocaleDateString('ar-EG') : '-';

  document.getElementById('investor-exit-title').textContent = `تقرير خروج / تصفية: ${inv.name}`;
  document.getElementById('investor-exit-body').innerHTML = `
    <div class="bg-slate-50 border border-slate-100 rounded-xl p-4 text-sm space-y-2">
      <div class="flex justify-between"><span class="text-slate-500">رأس المال المسترد</span><strong class="text-teal-600">${fmt(report.capitalAmount)} ج.م</strong></div>
      <div class="flex justify-between"><span class="text-slate-500">نصيبه من الأرباح (من ${escapeHTML(periodStartText)} حتى ${escapeHTML(periodEndText)})</span><strong class="${report.profitShare >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${fmt(report.profitShare)} ج.م</strong></div>
      <div class="flex justify-between"><span class="text-slate-500">المسحوب فعلاً من الأرباح قبل كده</span><strong>${fmt(report.withdrawn)} ج.م</strong></div>
      <div class="flex justify-between border-t border-slate-200 pt-2"><span class="text-slate-600 font-semibold">إجمالي المستحق له عند الخروج</span><strong class="text-slate-900">${fmt(report.totalDue)} ج.م</strong></div>
    </div>

    <div class="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-800 flex items-start gap-2">
      <i class="ph ph-info mt-0.5"></i>
      <span>المستحق مش كله كاش جاهز فوراً — جزء منه شغال في بضاعة لسه ما اتباعتش وأقساط لسه ما اتحصلتش. التقسيم تحت تقديري بالتناسب مع نصيب المستثمر من إجمالي مستحقات كل المستثمرين.</span>
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
        <span class="text-sm font-semibold text-emerald-800 flex items-center gap-2"><i class="ph ph-money"></i> متاح كاش فوراً (من الخزينة)</span>
        <strong class="text-emerald-700 font-mono">${fmt(report.cashPortion)} ج.م</strong>
      </div>
      <div class="flex items-center justify-between p-3 bg-sky-50 border border-sky-100 rounded-lg">
        <span class="text-sm font-semibold text-sky-800 flex items-center gap-2"><i class="ph ph-package"></i> شغال في بضاعة متاحة لسه ما اتباعتش</span>
        <strong class="text-sky-700 font-mono">${fmt(report.inventoryPortion)} ج.م</strong>
      </div>
      <div class="flex items-center justify-between p-3 bg-violet-50 border border-violet-100 rounded-lg">
        <span class="text-sm font-semibold text-violet-800 flex items-center gap-2"><i class="ph ph-receipt"></i> شغال في أقساط لسه ما اتحصلتش من العملاء</span>
        <strong class="text-violet-700 font-mono">${fmt(report.installmentsPortion)} ج.م</strong>
      </div>
      <div class="flex items-center justify-between p-3 bg-orange-50 border border-orange-100 rounded-lg">
        <span class="text-sm font-semibold text-orange-800 flex items-center gap-2"><i class="ph ph-user-focus"></i> عهد محصلين معلقة</span>
        <strong class="text-orange-700 font-mono">${fmt(report.custodyPortion)} ج.م</strong>
      </div>
      <div class="flex items-center justify-between p-3 bg-slate-100 border border-slate-200 rounded-lg">
        <span class="text-sm font-bold text-slate-700">إجمالي غير سائل (شغال برّه)</span>
        <strong class="text-slate-800 font-mono">${fmt(report.nonLiquidPortion)} ج.م</strong>
      </div>
    </div>
  `;
  document.getElementById('investor-exit-print-btn').setAttribute('onclick', `printInvestorExitStatement('${investorId}')`);
  openModal('investor-exit-modal');
};

// ================= تقرير خروج / تصفية مستثمر (نسخة قابلة للطباعة) =================
window.printInvestorExitStatement = function(investorId) {
  const report = computeInvestorExitReport(investorId);
  if (!report) return;
  const inv = report.investor;
  const companyName = db.settings.companyName || 'شركة SKY';
  const fmt = (n) => Math.round(n).toLocaleString();
  const periodStartText = report.periodStart ? report.periodStart.toLocaleDateString('ar-EG') : '-';
  const periodEndText = report.periodEnd ? report.periodEnd.toLocaleDateString('ar-EG') : '-';

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    <div class="print-doc-title">تقرير خروج / تصفية مستثمر</div>

    <div class="print-doc-row"><span>اسم المستثمر</span><strong>${escapeHTML(inv.name)}</strong></div>
    <div class="print-doc-row"><span>فترة احتساب الأرباح</span><strong>${escapeHTML(periodStartText)} — ${escapeHTML(periodEndText)}</strong></div>

    <div style="margin-top:14px; padding:10px 12px; background:#ecfdf5; border-radius:8px; display:flex; justify-content:space-around; text-align:center; font-size:0.85rem; flex-wrap:wrap; gap:8px;">
      <div><div style="color:#64748b; font-size:0.7rem;">رأس المال المسترد</div><strong>${fmt(report.capitalAmount)} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">نصيبه من الأرباح</div><strong style="color:#059669;">${fmt(report.profitShare)} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">المسحوب فعلاً</div><strong style="color:#d97706;">${fmt(report.withdrawn)} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي المستحق</div><strong>${fmt(report.totalDue)} ج.م</strong></div>
    </div>

    <div style="margin-top:18px;">
      <strong style="font-size:0.9rem;">تفصيل المستحق: سائل مقابل شغال في الأصول</strong>
      <table class="print-doc-table" style="margin-top:8px;">
        <thead><tr><th>البند</th><th>القيمة</th></tr></thead>
        <tbody>
          <tr><td>متاح كاش فوراً (خزينة)</td><td>${fmt(report.cashPortion)} ج.م</td></tr>
          <tr><td>شغال في بضاعة متاحة</td><td>${fmt(report.inventoryPortion)} ج.م</td></tr>
          <tr><td>شغال في أقساط عملاء</td><td>${fmt(report.installmentsPortion)} ج.م</td></tr>
          <tr><td>عهد محصلين معلقة</td><td>${fmt(report.custodyPortion)} ج.م</td></tr>
          <tr><td><strong>إجمالي غير سائل</strong></td><td><strong>${fmt(report.nonLiquidPortion)} ج.م</strong></td></tr>
        </tbody>
      </table>
    </div>

    <div class="print-doc-signatures">
      <div>توقيع مسؤول الحسابات: ______________</div>
      <div>توقيع المستثمر: ______________</div>
    </div>
    <div class="print-doc-footer">تم إصدار هذا التقرير إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${new Date().toLocaleString('ar-EG')}. القيم غير السائلة تقديرية بالتناسب وقابلة للتغيير حسب سرعة تحصيل الأقساط وبيع البضاعة.</div>
  `;

  printHTML(html);
  logAction('طباعة تقرير خروج', `طباعة تقرير خروج/تصفية للمستثمر ${inv.name}`);
};

// ================= تجميد صافي الربح (Snapshot دوري) =================
// آلية بسيطة لتثبيت "صورة" من صافي الربح والأرصدة الحالية بتاريخ معين، عشان
// يكون عندك مرجع تاريخي ثابت (شهري/ربع سنوي) مش متأثر بتقلبات المخزون
// والخزينة اليومية اللي بيتأثر بيها الحساب اللحظي.
window.freezeInvestorProfitSnapshot = async function() {
  await runWithActionLock("freeze-investor-snapshot", async () => {
  const stats = computeInvestorFinancials();
  if (!(await customConfirm(`هيتم تجميد صافي الربح الحالي (${Math.round(stats.netProfit).toLocaleString()} ج.م) وقفل الفترة المحاسبية الحالية بتاريخ اليوم.\n\nنصيب كل مستثمر لحد دلوقتي هيتثبّت، وأي مستثمر جديد يدخل بعد كده هيشارك بس في الأرباح اللي هتتحقق من بعد تاريخ التجميد ده (مش قبله). تحب تكمل؟`))) return;

  const snapshotId = `snap-${Date.now()}`;
  const snapshot = {
    id: snapshotId,
    timestamp: nowTimestamp(),
    // FEATURE: علامة على طريقة حساب الربح المستخدمة وقت التجميد ده، عشان
    // نقدر نميّز التجميدات القديمة (بالطريقة القديمة القائمة على أصول
    // الشركة) عن الجديدة (القائمة على مبيعات فعلية فقط)، ونحذّر الأدمن لو
    // فيه خليط بين الاتنين (شوف renderInvestors تحت).
    computationMethod: 'realized-sales-v1',
    totalAssets: stats.totalAssets,
    totalCapital: stats.totalCapital,
    totalWithdrawn: stats.totalWithdrawn,
    netProfit: stats.netProfit,
    perInvestor: stats.investors.map(inv => ({
      investorId: inv.id, name: inv.name, capitalAmount: inv.capitalAmount || 0,
      sharePercent: inv.sharePercent, profitShare: inv.profitShare,
      withdrawn: inv.withdrawn, remainingDue: inv.remainingDue
    }))
  };

  db.investorSnapshots = db.investorSnapshots || [];
  db.investorSnapshots.unshift(snapshot);
  logAction('تجميد أرباح', `تجميد صورة لصافي الربح بتاريخ اليوم: ${Math.round(stats.netProfit).toLocaleString()} ج.م`);
  await syncWithAppsScript('addInvestorSnapshot', { snapshot });

  showToast('✅ تم تجميد صورة الأرباح بنجاح.', 'success');
  renderInvestors();
  });
};

window.viewSnapshotsHistory = function() {
  const snapshots = db.investorSnapshots || [];
  const body = document.getElementById('snapshots-history-body');
  const admin = isAdmin();

  if (snapshots.length === 0) {
    body.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">لا توجد أي تجميدات محفوظة بعد. استخدم زرار "تجميد الأرباح الحالية" لإنشاء أول صورة تاريخية.</div>`;
  } else {
    body.innerHTML = snapshots.map(snap => `
      <div class="border border-slate-100 rounded-xl p-4 space-y-2">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <strong class="text-sm text-slate-700">${escapeHTML(snap.timestamp)}</strong>
          <div class="flex items-center gap-3 text-xs">
            <span class="text-slate-500">صافي الربح وقتها: <strong class="${snap.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${Math.round(snap.netProfit).toLocaleString()} ج.م</strong></span>
            ${admin ? `<button onclick="deleteInvestorSnapshot('${snap.id}')" class="p-1 text-slate-400 hover:text-rose-500" title="حذف هذا السجل"><i class="ph ph-trash"></i></button>` : ''}
          </div>
        </div>
        <div class="table-scroll-wrapper">
          <table class="w-full text-right border-collapse text-xs">
            <thead>
              <tr class="bg-slate-50 text-slate-500"><th class="p-2">المستثمر</th><th class="p-2">رأس المال</th><th class="p-2">النسبة</th><th class="p-2">نصيبه</th><th class="p-2">المتبقي له</th></tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${(snap.perInvestor || []).map(p => `
                <tr>
                  <td class="p-2 font-semibold">${escapeHTML(p.name)}</td>
                  <td class="p-2 font-mono">${(p.capitalAmount || 0).toLocaleString()} ج.م</td>
                  <td class="p-2 font-mono">${(p.sharePercent || 0).toFixed(1)}%</td>
                  <td class="p-2 font-mono">${Math.round(p.profitShare || 0).toLocaleString()} ج.م</td>
                  <td class="p-2 font-mono">${Math.round(p.remainingDue || 0).toLocaleString()} ج.م</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `).join('');
  }
  openModal('snapshots-history-modal');
};

window.deleteInvestorSnapshot = async function(snapshotId) {
  await runWithActionLock(`delete-snapshot-${snapshotId}`, async () => {
  if (!(await customConfirm('هل أنت متأكد من حذف هذا السجل التاريخي؟ الإجراء ده لا يمكن التراجع عنه.'))) return;
  db.investorSnapshots = (db.investorSnapshots || []).filter(s => s.id !== snapshotId);
  logAction('حذف تجميد أرباح', `حذف سجل تجميد أرباح تاريخي`);
  await syncWithAppsScript('deleteInvestorSnapshot', { id: snapshotId });
  viewSnapshotsHistory();
  });
};

document.getElementById('add-investor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('investor-name').value.trim();
  const capitalAmount = parseFloat(document.getElementById('investor-capital').value);
  const joinDate = document.getElementById('investor-join-date').value;
  const notes = document.getElementById('investor-notes').value.trim();
  const fixedShareRaw = document.getElementById('investor-fixed-share').value;
  const fixedSharePercent = fixedShareRaw !== '' ? parseFloat(fixedShareRaw) : null;

  if (!name || !capitalAmount || capitalAmount <= 0) return;
  if (fixedSharePercent !== null && (isNaN(fixedSharePercent) || fixedSharePercent < 0 || fixedSharePercent > 100)) {
    showToast('❌ نسبة الشراكة الثابتة لازم تكون رقم بين 0 و 100.', 'error');
    return;
  }
  // FIX (تقرير الفحص - بند ٤.٢): كان ممكن يتسجل مستثمرين بنسب ثابتة مجموعها
  // يتجاوز 100% بالغلط، مما يوزّع أكتر من الربح المتاح فعلياً وقت الحساب.
  // بنتحقق هنا إن مجموع كل النسب الثابتة المخزَّنة فعلاً (القدامى + الجديدة)
  // ميتجاوزش 100% قبل الحفظ.
  if (fixedSharePercent !== null) {
    const existingFixedSum = db.investors.reduce((sum, inv) => {
      const has = inv.fixedSharePercent !== undefined && inv.fixedSharePercent !== null && inv.fixedSharePercent !== '' && !isNaN(inv.fixedSharePercent);
      return sum + (has ? Number(inv.fixedSharePercent) : 0);
    }, 0);
    if (existingFixedSum + fixedSharePercent > 100.0001) {
      showToast(`❌ مجموع النسب الثابتة لكل المستثمرين (${(existingFixedSum + fixedSharePercent).toFixed(1)}٪) يتجاوز 100٪. النسب الثابتة الحالية = ${existingFixedSum.toFixed(1)}٪.`, 'error');
      return;
    }
  }

  const investorId = `inv-${Date.now()}`;
  const newInvestor = {
    id: investorId,
    name,
    capitalAmount,
    joinDate: joinDate || nowTimestamp().split(' ')[0],
    notes,
    totalWithdrawn: 0,
    fixedSharePercent: fixedSharePercent
  };

  const txId = `tx-cap-${Date.now()}`;
  const capitalTx = {
    id: txId,
    timestamp: nowTimestamp(),
    type: 'capital_injection',
    amount: capitalAmount,
    investorId,
    notes: `ضخ رأس مال من المستثمر: ${name}`
  };

  db.investors.push(newInvestor);
  db.treasuryTransactions.unshift(capitalTx);
  logAction('إضافة مستثمر', `إضافة المستثمر ${name} برأس مال ${capitalAmount.toLocaleString()} ج.م`);

  await syncWithAppsScript('addInvestor', { investor: newInvestor, transaction: capitalTx });

  closeModal('add-investor-modal');
  document.getElementById('add-investor-form').reset();
  renderInvestors();
  renderTreasury();
  renderDashboard();
});

document.getElementById('edit-investor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const investorId = document.getElementById('edit-investor-id').value;
  const name = document.getElementById('edit-investor-name').value.trim();
  const joinDate = document.getElementById('edit-investor-join-date').value;
  const notes = document.getElementById('edit-investor-notes').value.trim();
  const fixedShareRaw = document.getElementById('edit-investor-fixed-share').value;
  const fixedSharePercent = fixedShareRaw !== '' ? parseFloat(fixedShareRaw) : null;

  const inv = db.investors.find(i => i.id === investorId);
  if (!inv || !name) return;
  if (fixedSharePercent !== null && (isNaN(fixedSharePercent) || fixedSharePercent < 0 || fixedSharePercent > 100)) {
    showToast('❌ نسبة الشراكة الثابتة لازم تكون رقم بين 0 و 100.', 'error');
    return;
  }
  // FIX (تقرير الفحص - بند ٤.٢): نفس تحقق مجموع 100% لكن هنا بنستثني نسبة
  // المستثمر الحالي القديمة من المجموع قبل ما نضيف نسبته الجديدة.
  if (fixedSharePercent !== null) {
    const otherFixedSum = db.investors.filter(i => i.id !== investorId).reduce((sum, i) => {
      const has = i.fixedSharePercent !== undefined && i.fixedSharePercent !== null && i.fixedSharePercent !== '' && !isNaN(i.fixedSharePercent);
      return sum + (has ? Number(i.fixedSharePercent) : 0);
    }, 0);
    if (otherFixedSum + fixedSharePercent > 100.0001) {
      showToast(`❌ مجموع النسب الثابتة لكل المستثمرين (${(otherFixedSum + fixedSharePercent).toFixed(1)}٪) يتجاوز 100٪. باقي المستثمرين الثابتين = ${otherFixedSum.toFixed(1)}٪.`, 'error');
      return;
    }
  }

  inv.name = name;
  inv.joinDate = joinDate || inv.joinDate;
  inv.notes = notes;
  inv.fixedSharePercent = fixedSharePercent;

  logAction('تعديل مستثمر', `تعديل بيانات المستثمر ${inv.name}`);
  await syncWithAppsScript('editInvestor', { investorId, name: inv.name, joinDate: inv.joinDate, notes: inv.notes, fixedSharePercent: inv.fixedSharePercent });

  closeModal('edit-investor-modal');
  renderInvestors();
});

document.getElementById('add-capital-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const investorId = document.getElementById('add-capital-investor-id').value;
  const amount = parseFloat(document.getElementById('add-capital-amount').value);
  const notes = document.getElementById('add-capital-notes').value.trim();

  const inv = db.investors.find(i => i.id === investorId);
  if (!inv || !amount || amount <= 0) return;

  inv.capitalAmount = (inv.capitalAmount || 0) + amount;

  const txId = `tx-cap-${Date.now()}`;
  const capitalTx = {
    id: txId,
    timestamp: nowTimestamp(),
    type: 'capital_injection',
    amount: amount,
    investorId,
    notes: `زيادة رأس مال من المستثمر ${inv.name}${notes ? ': ' + notes : ''}`
  };

  db.treasuryTransactions.unshift(capitalTx);
  logAction('زيادة رأس مال', `زيادة رأس مال المستثمر ${inv.name} بمبلغ ${amount.toLocaleString()} ج.م`);

  await syncWithAppsScript('addInvestorCapital', { investorId, newCapitalAmount: inv.capitalAmount, transaction: capitalTx });

  closeModal('add-capital-modal');
  document.getElementById('add-capital-form').reset();
  renderInvestors();
  renderTreasury();
  renderDashboard();
});

document.getElementById('withdraw-capital-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const investorId = document.getElementById('withdraw-capital-investor-id').value;
  const amount = parseFloat(document.getElementById('withdraw-capital-amount').value);
  const notes = document.getElementById('withdraw-capital-notes').value.trim();

  const inv = db.investors.find(i => i.id === investorId);
  if (!inv || !amount || amount <= 0) return;

  const currentCapital = inv.capitalAmount || 0;
  if (amount > currentCapital) {
    showToast(`❌ المبلغ المطلوب سحبه (${amount.toLocaleString()} ج.م) أكبر من رأس مال المستثمر الحالي (${currentCapital.toLocaleString()} ج.م).`, 'error');
    return;
  }

  // FEATURE: لو المبلغ أكبر من حد الموافقة الإضافية، بيتحول لطلب معلّق
  // محتاج موافقة أدمن تاني، بدل ما ينفّذ فورًا.
  const withdrawalThreshold = safeNum(db.settings.withdrawalApprovalThreshold);
  if (withdrawalThreshold > 0 && amount > withdrawalThreshold) {
    const pendingEntry = {
      id: `pwd-${Date.now()}`,
      type: 'capital_withdrawal',
      investorId, investorName: inv.name,
      amount, notes,
      requestedBy: currentUser ? currentUser.name : 'مجهول',
      requestedByUserId: currentUser ? currentUser.id : '',
      status: 'pending',
      timestamp: nowTimestamp()
    };
    db.pendingWithdrawals.unshift(pendingEntry);
    await syncWithAppsScript('addPendingWithdrawal', pendingEntry);
    logAction('طلب سحب معلّق', `طلب سحب رأس مال ${amount.toLocaleString()} ج.م للمستثمر ${inv.name} - محتاج موافقة أدمن تاني`);
    closeModal('withdraw-capital-modal');
    document.getElementById('withdraw-capital-form').reset();
    updateNotificationBell();
    showToast(`⏳ المبلغ أكبر من حد الموافقة (${withdrawalThreshold.toLocaleString()} ج.م) - تم إرسال طلب السحب لموافقة أدمن تاني`, 'success');
    return;
  }

  if (amount === currentCapital) {
    if (!(await customConfirm(`المبلغ اللي هتسحبه هيصفّر رأس مال هذا المستثمر بالكامل. لو عايز تخرجه نهائياً من سجل المستثمرين استخدم "حذف" بدلاً من كده. تحب تكمل السحب برضه؟`))) return;
  }

  inv.capitalAmount = currentCapital - amount;

  const txId = `tx-capwd-${Date.now()}`;
  const withdrawTx = {
    id: txId,
    timestamp: nowTimestamp(),
    type: 'capital_withdrawal',
    amount: -amount,
    investorId,
    notes: `سحب رأس مال للمستثمر ${inv.name}${notes ? ': ' + notes : ''}`
  };

  db.treasuryTransactions.unshift(withdrawTx);
  logAction('سحب رأس مال', `سحب المستثمر ${inv.name} مبلغ ${amount.toLocaleString()} ج.م من رأس ماله`);

  await syncWithAppsScript('withdrawInvestorCapital', { investorId, newCapitalAmount: inv.capitalAmount, transaction: withdrawTx });

  closeModal('withdraw-capital-modal');
  document.getElementById('withdraw-capital-form').reset();
  renderInvestors();
  renderTreasury();
  renderDashboard();
});

document.getElementById('withdraw-profit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const investorId = document.getElementById('withdraw-profit-investor-id').value;
  const amount = parseFloat(document.getElementById('withdraw-profit-amount').value);
  const notes = document.getElementById('withdraw-profit-notes').value.trim();

  const inv = db.investors.find(i => i.id === investorId);
  if (!inv || !amount || amount <= 0) return;

  const stats = computeInvestorFinancials();
  const invStats = stats.investors.find(i => i.id === investorId);
  if (invStats && amount > invStats.remainingDue + 0.01) {
    if (!(await customConfirm(`المبلغ اللي داخله (${amount.toLocaleString()} ج.م) أكبر من نصيب المستثمر المتبقي من الأرباح (${Math.round(invStats.remainingDue).toLocaleString()} ج.م).\n\nتحب تكمل وتسجل السحب برضه؟`))) {
      return;
    }
  }

  // FEATURE: نفس بوابة الموافقة الإضافية للسحوبات الكبيرة، بنفس المنطق
  // المستخدم في سحب رأس المال.
  const profitWithdrawalThreshold = safeNum(db.settings.withdrawalApprovalThreshold);
  if (profitWithdrawalThreshold > 0 && amount > profitWithdrawalThreshold) {
    const pendingEntry = {
      id: `pwd-${Date.now()}`,
      type: 'profit_withdrawal',
      investorId, investorName: inv.name,
      amount, notes,
      requestedBy: currentUser ? currentUser.name : 'مجهول',
      requestedByUserId: currentUser ? currentUser.id : '',
      status: 'pending',
      timestamp: nowTimestamp()
    };
    db.pendingWithdrawals.unshift(pendingEntry);
    await syncWithAppsScript('addPendingWithdrawal', pendingEntry);
    logAction('طلب سحب معلّق', `طلب سحب أرباح ${amount.toLocaleString()} ج.م للمستثمر ${inv.name} - محتاج موافقة أدمن تاني`);
    closeModal('withdraw-investor-profit-modal');
    document.getElementById('withdraw-profit-form').reset();
    updateNotificationBell();
    showToast(`⏳ المبلغ أكبر من حد الموافقة (${profitWithdrawalThreshold.toLocaleString()} ج.م) - تم إرسال طلب السحب لموافقة أدمن تاني`, 'success');
    return;
  }

  inv.totalWithdrawn = (inv.totalWithdrawn || 0) + amount;

  const txId = `tx-wd-${Date.now()}`;
  const withdrawTx = {
    id: txId,
    timestamp: nowTimestamp(),
    type: 'profit_withdrawal',
    amount: -amount,
    investorId,
    notes: `سحب أرباح للمستثمر ${inv.name}${notes ? ': ' + notes : ''}`
  };

  db.treasuryTransactions.unshift(withdrawTx);
  logAction('سحب أرباح مستثمر', `سحب المستثمر ${inv.name} مبلغ ${amount.toLocaleString()} ج.م من نصيبه في الأرباح`);

  await syncWithAppsScript('withdrawInvestorProfit', { investorId, newTotalWithdrawn: inv.totalWithdrawn, transaction: withdrawTx });

  closeModal('withdraw-investor-profit-modal');
  document.getElementById('withdraw-profit-form').reset();
  renderInvestors();
  renderTreasury();
  renderDashboard();
});

window.approveCollectorCustody = async function(id) {
  await runWithActionLock(`approve-custody-${id}`, async () => {
  const custody = db.collectorCustodies.find(c => c.id === id);
  // FIX: نتأكد إن حالتها لسه 'pending' - لو اتاعتمدت خلاص (مثلاً بضغطة
  // سابقة) منعيدش المعالجة تاني ونضاعف التحصيل بالغلط.
  if (!custody || custody.status !== 'pending') return;
  
  const inst = db.installments.find(i => i.id === custody.installmentId);
  if (!inst) return;
  
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  custody.status = 'approved';

  // مهم: لازم نحسب الغرامة الفعلية قبل ما نغيّر حالة القسط لـ 'paid'،
  // لأن دالة حساب الغرامة نفسها بترجع القيمة القديمة زي ما هي فوراً
  // لو لقيت القسط متسدد خلاص (عشان متحسبش غرامة على قسط لسه هينتظر).
  const contract = db.contracts.find(c => c.id === inst.contractId);
  if (contract) {
    inst.delayFines = calculateFinesForInstallment(inst, contract);
  }

  // بيدعم السداد الجزئي: بنجمع أي مبالغ سابقة اتحصّلت جزئياً على نفس
  // القسط، ومنعتبروش "مسدد بالكامل" غير لما المجموع يغطي كامل المطلوب
  // (القسط + الغرامة). لو لسه ناقص، القسط يفضل بحالته الحالية والمبلغ
  // المتبقي يظهر تلقائياً في المرة الجاية.
  const cumulativePaid = safeNum(inst.paidAmount) + safeNum(custody.amount);
  const fullDueAmount = safeNum(inst.amount) + safeNum(inst.delayFines);
  const isFullyPaid = cumulativePaid >= fullDueAmount - 0.01;

  inst.paidAmount = cumulativePaid;
  inst.receiptId = custody.id;
  if (isFullyPaid) {
    inst.status = 'paid';
    inst.paidDate = timestamp.split(' ')[0];
  }

  const collectionTx = {
    id: `tx-col-${Date.now()}`,
    timestamp: timestamp,
    type: 'collection',
    amount: custody.amount,
    notes: `تحصيل ${isFullyPaid ? '' : 'جزئي '}قسط رقم ${inst.installmentNum} لعقد ${inst.contractId.replace('con-', '')} للعميل ${custody.clientName} (بمعرفة المحصل ${custody.collectorName})`
  };
  db.treasuryTransactions.unshift(collectionTx);

  logAction('اعتماد عهدة', `اعتماد ${isFullyPaid ? '' : 'دفعة جزئية من '}عهدة المحصل ${custody.collectorName} بمبلغ ${custody.amount} ج.م للعميل ${custody.clientName}`);
  
  await syncWithAppsScript('approveCustody', { 
    custodyId: id, 
    installmentId: inst.id, 
    amount: custody.amount, 
    timestamp,
    installment: inst,
    transaction: collectionTx
  });

  renderTreasury();
  renderCollections();
  
  openWhatsappModal(inst.id, 'receipt', custody.amount);
  });
};

window.rejectCollectorCustody = async function(id) {
  await runWithActionLock(`reject-custody-${id}`, async () => {
  if (await customConfirm('هل أنت متأكد من حذف وإلغاء معاملة التحصيل هذه من عهدة المحصل؟')) {
    db.collectorCustodies = db.collectorCustodies.filter(c => c.id !== id);
    logAction('إلغاء عهدة معلقة', `إلغاء معاملة تحصيل عهدة برقم ${id}`);
    renderTreasury();
    await syncWithAppsScript('deleteCustody', { id });
  }
  });
};

// --- 7. REPORTS ---
function renderReports() {
  const fromInput = document.getElementById('report-from-date');
  const toInput = document.getElementById('report-to-date');

  // افتراضياً: من أول الشهر الحالي لحد النهاردة، لو المستخدم لسه ما حددش فترة
  if (!fromInput.value) {
    const now = new Date();
    fromInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }
  if (!toInput.value) {
    toInput.value = new Date().toISOString().split('T')[0];
  }

  const fromDate = fromInput.value;
  const toDate = toInput.value;

  // ---- KPIs (حسب الفترة المختارة) ----
  const contractsInRange = db.contracts.filter(c => c.startDate >= fromDate && c.startDate <= toDate);
  const salesInRange = contractsInRange.reduce((sum, c) => sum + safeNum(c.totalValue), 0);

  const txInRange = db.treasuryTransactions.filter(tx => {
    const txDate = (tx.timestamp || '').split(' ')[0];
    return txDate >= fromDate && txDate <= toDate;
  });
  // FIX: نفس مشكلة صافي الربح في الداشبورد - كان بيتجاهل البيع الكاش
  // (cash_sale) تمامًا من "إجمالي التحصيل بالفترة" وبالتالي من "الصافي".
  // FIX: نفس مشكلة صافي الربح - كان بيتجاهل بيع الأصناف العامة كاش (product_sale).
  // FIX: كمان كان بيتجاهل حركات استرداد التحصيلات (type: 'out') الناتجة عن
  // حذف عقد/قسط مسدد - فحذف عقد كان يصحح الرصيد الكلي بس مش "التحصيل بالفترة".
  const collectionsInRange = txInRange.filter(tx => tx.type === 'collection' || tx.type === 'cash_sale' || tx.type === 'product_sale' || tx.type === 'out').reduce((sum, tx) => sum + safeAmount(tx), 0);
  // إجمالي المصروفات والمشتريات = حركات الخزينة (مشتريات/سدادات) + المصروفات التشغيلية المسجلة بالفترة
  const opsExpensesInRange = db.expenses
    .filter(e => e.date >= fromDate && e.date <= toDate)
    .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  // FIX: db.expenses فوق بيتحدّث ذاتيًا (المصروف بيتشال فعليًا منه لو
  // اتحذف، والقيمة بتتعدل فعليًا لو اتعدلت) - فجمع حركات الخزينة بنوع
  // 'expense' هنا كمان كان بيعدّ نفس المصروف مرتين (مرة من db.expenses
  // ومرة من treasuryTransactions). استبعدناها هنا، وضفنا بس حركة استرداد
  // مشتريات المخزون الكاش (مفيهاش مصدر تاني بيتحدّث ذاتيًا زي db.expenses).
  const treasuryExpensesInRange = Math.abs(txInRange.filter(tx =>
    tx.type === 'inventory_purchase' || tx.type === 'product_purchase' || tx.type === 'supplier_payment' ||
    (tx.type === 'in' && tx.category === 'استرداد مشتريات مخزون')
  ).reduce((sum, tx) => sum + safeAmount(tx), 0));
  
  const totalExpensesInRange = opsExpensesInRange + treasuryExpensesInRange;
  const netInRange = collectionsInRange - totalExpensesInRange;

  document.getElementById('report-kpi-sales').textContent = `${salesInRange.toLocaleString()} ج.م`;
  document.getElementById('report-kpi-collections').textContent = `${collectionsInRange.toLocaleString()} ج.م`;
  document.getElementById('report-kpi-expenses').textContent = `${totalExpensesInRange.toLocaleString()} ج.م`;
  document.getElementById('report-kpi-net').textContent = `${netInRange.toLocaleString()} ج.م`;

  // ---- أداء المحصلين خلال الفترة ----
  const collectors = db.users.filter(u => u.role === 'COLLECTOR');
  const collectorsBody = document.getElementById('report-collectors-body');
  collectorsBody.innerHTML = '';

  collectors.forEach(col => {
    const paidInRange = db.installments.filter(i =>
      i.status === 'paid' && i.collectorName === col.name && i.paidDate >= fromDate && i.paidDate <= toDate
    );
    const collectedAmount = paidInRange.reduce((sum, i) => sum + safeNum(i.paidAmount || i.amount), 0);
    const overdueAssigned = db.installments.filter(i => {
      if (i.collectorName !== col.name || i.status === 'paid') return false;
      return getInstallmentOverdueStatus(i).overdueDays > 0;
    }).length;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="p-3 font-bold">${escapeHTML(col.name)}</td>
      <td class="p-3 font-mono">${paidInRange.length}</td>
      <td class="p-3 font-mono font-bold text-emerald-600">${collectedAmount.toLocaleString()} ج.م</td>
      <td class="p-3 font-mono ${overdueAssigned > 0 ? 'text-rose-600 font-bold' : 'text-slate-500'}">${overdueAssigned}</td>
    `;
    collectorsBody.appendChild(row);
  });

  // ---- العملاء المتأخرون حالياً (لقطة لحظية، مش مرتبطة بفلتر التاريخ) ----
  const overdueByClient = {};
  db.installments.forEach(inst => {
    if (inst.status === 'paid') return;
    const stats = getInstallmentOverdueStatus(inst);
    if (stats.overdueDays <= 0) return;
    const contract = db.contracts.find(c => c.id === inst.contractId);
    const clientId = contract?.clientId || inst.clientName;
    if (!overdueByClient[clientId]) {
      overdueByClient[clientId] = { name: inst.clientName, phone: inst.clientPhone, collectorName: inst.collectorName || '—', count: 0, totalDue: 0, maxDays: 0 };
    }
    overdueByClient[clientId].count++;
    overdueByClient[clientId].totalDue += stats.totalDue;
    // لو أقساط العميل المتأخرة موزّعة على أكتر من محصّل، نعرض اسم محصّل
    // القسط الأكتر تأخيراً (الأولوية الأهم للمتابعة) بدل ما نسيب الخانة فاضية
    if (stats.overdueDays >= overdueByClient[clientId].maxDays) {
      overdueByClient[clientId].collectorName = inst.collectorName || '—';
    }
    overdueByClient[clientId].maxDays = Math.max(overdueByClient[clientId].maxDays, stats.overdueDays);
  });

  const overdueBody = document.getElementById('report-overdue-body');
  const overdueEmpty = document.getElementById('report-overdue-empty');
  overdueBody.innerHTML = '';
  const overdueList = Object.values(overdueByClient).sort((a, b) => b.maxDays - a.maxDays);

  if (overdueList.length === 0) {
    overdueEmpty.classList.remove('hidden');
  } else {
    overdueEmpty.classList.add('hidden');
    overdueList.forEach(c => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="p-3 font-bold">${escapeHTML(c.name)}</td>
        <td class="p-3 font-mono">${escapeHTML(c.phone)}</td>
        <td class="p-3">${escapeHTML(c.collectorName)}</td>
        <td class="p-3 font-mono">${c.count}</td>
        <td class="p-3 font-mono font-bold text-rose-600">${c.totalDue.toLocaleString()} ج.م</td>
        <td class="p-3 font-mono">${c.maxDays} يوم</td>
      `;
      overdueBody.appendChild(row);
    });
  }
}

// طباعة صفحة التقارير الحالية كمستند PDF/ورقي كامل
window.printReportsPage = function() {
  const companyName = db.settings.companyName || 'شركة SKY';
  const fromDate = document.getElementById('report-from-date').value;
  const toDate = document.getElementById('report-to-date').value;

  const collectorsRows = document.getElementById('report-collectors-body').innerHTML;
  const overdueRows = document.getElementById('report-overdue-body').innerHTML;
  const overdueEmptyVisible = !document.getElementById('report-overdue-empty').classList.contains('hidden');

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${companyName}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>الفترة:</strong> ${fromDate} إلى ${toDate}</div>
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    <div class="print-doc-title">تقرير مالي وتشغيلي شامل</div>

    <div class="print-doc-row"><span>مبيعات العقود بالفترة</span><strong>${document.getElementById('report-kpi-sales').textContent}</strong></div>
    <div class="print-doc-row"><span>إجمالي التحصيل بالفترة</span><strong>${document.getElementById('report-kpi-collections').textContent}</strong></div>
    <div class="print-doc-row"><span>إجمالي المصروفات والمشتريات</span><strong>${document.getElementById('report-kpi-expenses').textContent}</strong></div>
    <div class="print-doc-row"><span>صافي التدفق النقدي بالفترة</span><strong>${document.getElementById('report-kpi-net').textContent}</strong></div>

    <h4 style="margin-top:20px; margin-bottom:8px; font-weight:700;">أداء المحصلين خلال الفترة</h4>
    <table class="print-doc-table">
      <thead><tr><th>المحصل</th><th>عدد الأقساط المحصّلة</th><th>إجمالي المبلغ المحصَّل</th><th>أقساط متأخرة مسندة له حالياً</th></tr></thead>
      <tbody>${collectorsRows}</tbody>
    </table>

    <h4 style="margin-top:20px; margin-bottom:8px; font-weight:700;">العملاء المتأخرون حالياً</h4>
    ${overdueEmptyVisible ? '<p style="font-size:0.85rem; color:#64748b;">لا يوجد عملاء متأخرون حالياً.</p>' : `
    <table class="print-doc-table">
      <thead><tr><th>العميل</th><th>الهاتف</th><th>المحصّل</th><th>عدد الأقساط المتأخرة</th><th>إجمالي المستحق</th><th>أطول مدة تأخير</th></tr></thead>
      <tbody>${overdueRows}</tbody>
    </table>`}

    <div class="print-doc-footer">تم إصدار هذا التقرير إلكترونياً من نظام ${companyName}</div>
  `;
  printHTML(html);
  logAction('طباعة تقرير', `طباعة التقرير المالي والتشغيلي للفترة من ${fromDate} إلى ${toDate}`);
};

// --- 8. USER MANAGEMENT ---
function renderUsers() {
  const tbody = document.getElementById('users-table-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  if (!tbody) return;
  tbody.innerHTML = '';
  
  db.users.forEach(u => {
    let roleText = 'محصل خارجي';
    let roleColor = 'badge-info';
    if (u.role === 'ADMIN') {
      roleText = 'مشرف النظام (Admin)';
      roleColor = 'badge-danger';
    } else if (u.role === 'STAFF') {
      roleText = 'مدخل بيانات';
      roleColor = 'badge-success';
    }

    const adminBtns = isAdmin() ? `
      <button onclick="editUser('${u.id}')" class="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-md text-xs font-semibold transition-all flex items-center gap-1"><i class="ph ph-note-pencil"></i> تعديل</button>
      <button onclick="deleteUser('${u.id}')" class="p-1 text-rose-500 hover:bg-rose-50 rounded transition-colors"><i class="ph ph-trash"></i></button>
    ` : '<span class="text-xs text-slate-400">للمشرف فقط</span>';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-colors';
    tr.innerHTML = `
      <td class="p-4 font-bold text-slate-800">${escapeHTML(u.name)}</td>
      <td class="p-4 font-mono text-slate-500">${escapeHTML(u.username)}</td>
      <td class="p-4 font-mono">${escapeHTML(u.phone) || '-'}</td>
      <td class="p-4"><span class="badge ${roleColor}">${roleText}</span></td>
      <td class="p-4 text-slate-600">${escapeHTML(u.area) || '-'}</td>
      <td class="p-4 text-center">
        <div class="inline-flex gap-1.5">${adminBtns}</div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.editUser = function(userId) {
  if (!isAdmin()) {
    alert('⛔ هذه العملية مخصصة للمشرف (ADMIN) فقط.');
    return;
  }
  try {
    const u = db.users.find(x => x.id === userId);
    if (!u) return;

    document.getElementById('edit-user-id').value = u.id;
    document.getElementById('edit-user-fullname').value = u.name || '';
    document.getElementById('edit-user-username').value = u.username || '';
    document.getElementById('edit-user-phone').value = u.phone || '';
    document.getElementById('edit-user-role').value = u.role || 'COLLECTOR';
    document.getElementById('edit-user-area').value = u.area || '';
    openModal('edit-user-modal');
  } catch (err) {
    console.error('خطأ أثناء فتح نافذة تعديل المستخدم:', err);
    alert('❌ حصل خطأ غير متوقع أثناء فتح نافذة التعديل. افتح Console بالمتصفح (F12) وابعتلي رسالة الخطأ اللي ظهرت.');
  }
};

window.saveUserEdits = async function() {
  await runWithActionLock("save-user-edits", async () => {
  if (!isAdmin()) {
    alert('⛔ هذه العملية مخصصة للمشرف (ADMIN) فقط.');
    return;
  }
  try {
    const userId = document.getElementById('edit-user-id').value;
    const u = db.users.find(x => x.id === userId);
    if (!u) return;

    // ملاحظة: لا يمكن تعديل "اسم المستخدم" هنا لأنه مرتبط مباشرة بحساب Firebase
    // Authentication الحقيقي الخاص بهذا المستخدم (الحقل معطّل بالواجهة). كذلك لا
    // يمكن تغيير كلمة مرور مستخدم آخر من هنا لأسباب أمنية (Firebase Authentication
    // لا يسمح لحساب أدمن بتغيير كلمة مرور حساب آخر مباشرة من المتصفح) - استخدم
    // بدلاً من ذلك زرار "إرسال رابط تعيين كلمة مرور جديدة" إن وُجد بريد إلكتروني حقيقي.
    u.name = document.getElementById('edit-user-fullname').value.trim();
    u.phone = document.getElementById('edit-user-phone').value.trim();
    u.role = document.getElementById('edit-user-role').value;
    u.area = document.getElementById('edit-user-area').value.trim();

    logAction('تعديل مستخدم', `تعديل بيانات المستخدم ${u.name} (${u.role})`);
    // FIX: نحدّث مستند userRoles عشان لو اتغيّر الدور يتعكس فوراً على الصلاحيات
    if (u.authUid && window.FirebaseAuthService && window.FirebaseAuthService.ensureUserRoleDoc) {
      await window.FirebaseAuthService.ensureUserRoleDoc(u.authUid, u.role, u.name);
    }
    await syncWithAppsScript('updateUser', {
      id: u.id,
      authUid: u.authUid || null,
      name: u.name,
      phone: u.phone,
      role: u.role,
      area: u.area
    });

    closeModal('edit-user-modal');
    renderUsers();
    populateDropdowns();
    showToast('✅ تم حفظ تعديلات المستخدم بنجاح', 'success');
  } catch (err) {
    console.error('خطأ أثناء حفظ تعديلات المستخدم:', err);
    alert('❌ حصل خطأ غير متوقع أثناء حفظ التعديلات. افتح Console بالمتصفح (F12) وابعتلي رسالة الخطأ اللي ظهرت.');
  }
  });
};

// --- 7.5 AUDIT LOG (سجل العمليات - Admin Only) ---
function renderAuditLog() {
  const tbody = document.getElementById('audit-log-table-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  const emptyState = document.getElementById('audit-log-empty-state');
  if (!tbody) return;

  const searchVal = (document.getElementById('audit-log-search-input').value || '').trim().toLowerCase();
  const fromDate = document.getElementById('audit-log-from-date').value;
  const toDate = document.getElementById('audit-log-to-date').value;

  let filtered = sortByTimestampDesc([...db.auditLogs]);

  if (searchVal) {
    filtered = filtered.filter(log =>
      (log.user || '').toLowerCase().includes(searchVal) ||
      (log.actionType || '').toLowerCase().includes(searchVal) ||
      (log.details || '').toLowerCase().includes(searchVal)
    );
  }

  if (fromDate) {
    filtered = filtered.filter(log => (log.timestamp || '').split(' ')[0] >= fromDate);
  }
  if (toDate) {
    filtered = filtered.filter(log => (log.timestamp || '').split(' ')[0] <= toDate);
  }

  tbody.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    renderPaginationControls('audit-log', 1, 1, 0, 'audit-log-table-wrapper', renderAuditLog);
    return;
  }
  emptyState.classList.add('hidden');

  // IMPROVEMENT #1 (الأداء): ترقيم صفحات لسجل العمليات (ممكن يوصل لآلاف
  // السجلات مع الوقت).
  const pageItems = paginate('audit-log', filtered, 'audit-log-table-wrapper', renderAuditLog);

  pageItems.forEach(log => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition-colors';
    tr.innerHTML = `
      <td class="p-4 font-mono text-slate-500 whitespace-nowrap">${escapeHTML(log.timestamp)}</td>
      <td class="p-4 font-bold text-slate-800 whitespace-nowrap">${escapeHTML(log.user)}</td>
      <td class="p-4"><span class="badge bg-slate-100 text-slate-700 font-semibold">${escapeHTML(log.actionType)}</span></td>
      <td class="p-4 text-slate-600">${escapeHTML(log.details)}</td>
    `;
    tbody.appendChild(tr);
  });
}

window.resetAuditLogFilters = function() {
  document.getElementById('audit-log-search-input').value = '';
  document.getElementById('audit-log-from-date').value = '';
  document.getElementById('audit-log-to-date').value = '';
  renderAuditLog();
};

// طباعة/تصدير سجل العمليات الظاهر حالياً (بعد تطبيق الفلاتر) كمستند PDF/ورقي
// --- 7.6 EXPENSES (إدارة المصروفات) ---
function renderExpenses() {
  const tbody = document.getElementById('expenses-table-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  const emptyState = document.getElementById('expenses-empty-state');
  if (!tbody) return;
  checkPendingRecurringExpenses();

  const categoryFilter = document.getElementById('expense-filter-category').value;
  const monthFilter = document.getElementById('expense-filter-month').value;

  let filtered = sortByTimestampDesc([...db.expenses]);

  if (categoryFilter !== 'all') {
    filtered = filtered.filter(e => e.category === categoryFilter);
  }
  if (monthFilter) {
    filtered = filtered.filter(e => (e.date || '').substring(0, 7) === monthFilter);
  }

  tbody.innerHTML = '';
  
  // تحديث الإحصائيات في تبويب المصروفات
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const thisMonthStr = todayStr.substring(0, 7);

  const totalMonth = db.expenses
    .filter(e => (e.date || '').substring(0, 7) === thisMonthStr)
    .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
  
  const totalToday = db.expenses
    .filter(e => e.date === todayStr)
    .reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

  // حساب أكبر بند صرف
  const catTotals = {};
  db.expenses.forEach(e => {
    catTotals[e.category] = (catTotals[e.category] || 0) + parseFloat(e.amount || 0);
  });
  let topCat = '---';
  let maxVal = 0;
  for (const cat in catTotals) {
    if (catTotals[cat] > maxVal) {
      maxVal = catTotals[cat];
      topCat = cat;
    }
  }

  document.getElementById('stats-expenses-month').textContent = totalMonth.toLocaleString();
  document.getElementById('stats-expenses-today').textContent = totalToday.toLocaleString();
  document.getElementById('stats-expenses-top-category').textContent = topCat;

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    renderPaginationControls('expenses', 1, 1, 0, 'expenses-table-wrapper', renderExpenses);
    return;
  }
  emptyState.classList.add('hidden');

  // IMPROVEMENT #1 (الأداء): ترقيم صفحات للمصروفات.
  const pageItems = paginate('expenses', filtered, 'expenses-table-wrapper', renderExpenses);

  pageItems.forEach(e => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50/50 transition-colors';
    tr.innerHTML = `
      <td class="p-4 font-semibold text-slate-700">${e.date}</td>
      <td class="p-4">
        <span class="px-2 py-1 rounded-md bg-rose-50 text-rose-600 text-xs font-bold border border-rose-100">${e.category}</span>
      </td>
      <td class="p-4 font-bold text-rose-600">${Number(e.amount).toLocaleString()} ج.م</td>
      <td class="p-4 text-slate-600 text-xs max-w-xs truncate" title="${escapeHTML(e.description || '')}">${escapeHTML(e.description || 'بدون تفاصيل')}</td>
      <td class="p-4 text-slate-500 text-xs">${e.paidBy || 'غير معروف'}</td>
      <td class="p-4 text-center no-print">
        <div class="inline-flex gap-1">
          <button onclick="printExpenseReceipt('${e.id}')" class="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all" title="طباعة سند صرف">
            <i class="ph ph-printer text-lg"></i>
          </button>
          <button onclick="openEditExpenseModal('${e.id}')" class="p-2 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-all admin-only" title="تعديل المصروف">
            <i class="ph ph-pencil-simple text-lg"></i>
          </button>
          <button onclick="deleteExpense('${e.id}')" class="p-2 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all admin-only" title="حذف المصروف">
            <i class="ph ph-trash text-lg"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  updateUIForRole(); // لضمان إخفاء أزرار الحذف لغير الأدمن
}

window.resetExpenseFilters = function() {
  document.getElementById('expense-filter-category').value = 'all';
  document.getElementById('expense-filter-month').value = '';
  renderExpenses();
};

document.getElementById('add-expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn && submitBtn.disabled) return;
  const category = document.getElementById('expense-category').value;
  const amount = parseFloat(document.getElementById('expense-amount').value);
  const date = document.getElementById('expense-date').value;
  const description = document.getElementById('expense-description').value.trim();

  if (!category || isNaN(amount) || amount <= 0 || !date) {
    alert('⚠️ يرجى إكمال جميع الحقول المطلوبة بشكل صحيح.');
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الحفظ...'; }
  try {
    const expenseId = `exp-${Date.now()}`;
    const newExpense = {
      id: expenseId,
      category,
      amount,
      date,
      description,
      paidBy: currentUser ? currentUser.name : 'مجهول',
      timestamp: nowTimestamp()
    };

    db.expenses.push(newExpense);

    // ربط المصروف بالخزينة: إضافة حركة خروج نقدية
    const treasuryAction = {
      id: `tr-${Date.now()}`,
      type: 'expense',
      amount: -amount,
      category: 'مصروفات تشغيلية',
      method: 'cash',
      details: `مصروف: ${category} - ${description}`,
      user: currentUser ? currentUser.name : 'مجهول',
      timestamp: nowTimestamp()
    };
    db.treasuryTransactions.push(treasuryAction);

    logAction('تسجيل مصروف', `صرف مبلغ ${amount} ج.م لبند ${category}`);
    
    // المزامنة مع Firestore
    await syncWithAppsScript('addExpense', { expense: newExpense, transaction: treasuryAction });

    closeModal('add-expense-modal');
    document.getElementById('add-expense-form').reset();
    renderExpenses();
    renderTreasury();
    showToast('✅ تم تسجيل المصروف وخصمه من الخزينة بنجاح', 'success');
  } catch (err) {
    console.error('Error adding expense:', err);
    alert('❌ فشل تسجيل المصروف. يرجى المحاولة مرة أخرى.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'تسجيل المصروف'; }
  }
});

window.deleteExpense = async function(id) {
  await runWithActionLock(`delete-expense-${id}`, async () => {
  if (!isAdmin()) return;
  
  const expense = db.expenses.find(e => e.id === id);
  if (!expense) return;

  if (!(await customConfirm(`هل أنت متأكد من حذف هذا المصروف بقيمة ${expense.amount} ج.م؟ سيتم إرجاع المبلغ للخزينة تلقائياً.`))) return;

  try {
    // إرجاع المبلغ للخزينة: إضافة حركة دخول نقدية تعويضية
    const reverseTreasuryAction = {
      id: `tr-rev-${Date.now()}`,
      type: 'in',
      amount: parseFloat(expense.amount),
      category: 'استرداد مصروفات',
      method: 'cash',
      details: `استرداد مصروف محذوف: ${expense.category} - ${expense.description}`,
      user: currentUser ? currentUser.name : 'مجهول',
      timestamp: nowTimestamp()
    };
    
    db.treasuryTransactions.push(reverseTreasuryAction);
    db.expenses = db.expenses.filter(e => e.id !== id);
    
    logAction('حذف مصروف', `حذف مصروف بقيمة ${expense.amount} ج.م وإرجاع المبلغ للخزينة`);
    
    await syncWithAppsScript('deleteExpense', { id });
    await syncWithAppsScript('addTreasuryTransaction', reverseTreasuryAction);

    renderExpenses();
    renderTreasury();
    renderDashboard();
    showToast('✅ تم حذف المصروف وإرجاع المبلغ للخزينة بنجاح', 'success');
  } catch (err) {
    console.error('Error deleting expense:', err);
    showToast('❌ فشل حذف المصروف', 'error');
  }
  });
};

// فتح مودال تعديل مصروف موجود وتعبئته ببياناته الحالية
window.openEditExpenseModal = function(id) {
  if (!isAdmin()) return;
  const expense = db.expenses.find(e => e.id === id);
  if (!expense) return;

  document.getElementById('edit-expense-id').value = expense.id;
  document.getElementById('edit-expense-category').value = expense.category;
  document.getElementById('edit-expense-amount').value = expense.amount;
  document.getElementById('edit-expense-date').value = expense.date;
  document.getElementById('edit-expense-description').value = expense.description || '';
  openModal('edit-expense-modal');
};

document.getElementById('edit-expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn && submitBtn.disabled) return;
  const id = document.getElementById('edit-expense-id').value;
  const category = document.getElementById('edit-expense-category').value;
  const amount = parseFloat(document.getElementById('edit-expense-amount').value);
  const date = document.getElementById('edit-expense-date').value;
  const description = document.getElementById('edit-expense-description').value.trim();

  if (!category || isNaN(amount) || amount <= 0 || !date) {
    alert('⚠️ يرجى إكمال جميع الحقول المطلوبة بشكل صحيح.');
    return;
  }

  const expense = db.expenses.find(x => x.id === id);
  if (!expense) return;

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الحفظ...'; }
  try {
    const oldAmount = parseFloat(expense.amount);

    // 1. إرجاع المبلغ القديم للخزينة (حركة دخول تعويضية) عشان نحافظ على أثر واضح للتعديل
    const reverseTx = {
      id: `tr-rev-edit-${Date.now()}`,
      type: 'in',
      amount: oldAmount,
      category: 'استرداد مصروفات (تعديل)',
      method: 'cash',
      details: `إلغاء مصروف قديم بسبب التعديل: ${expense.category} - ${expense.description || ''}`,
      user: currentUser ? currentUser.name : 'مجهول',
      timestamp: nowTimestamp()
    };
    db.treasuryTransactions.push(reverseTx);

    // 2. تسجيل المبلغ الجديد كحركة خروج جديدة
    const newTx = {
      id: `tr-edit-${Date.now()}`,
      type: 'expense',
      amount: -amount,
      category: 'مصروفات تشغيلية',
      method: 'cash',
      details: `مصروف (بعد تعديل): ${category} - ${description}`,
      user: currentUser ? currentUser.name : 'مجهول',
      timestamp: nowTimestamp()
    };
    db.treasuryTransactions.push(newTx);

    // 3. تحديث بيانات المصروف نفسه
    expense.category = category;
    expense.amount = amount;
    expense.date = date;
    expense.description = description;

    logAction('تعديل مصروف', `تعديل مصروف من ${oldAmount} ج.م إلى ${amount} ج.م (${category})`);

    await syncWithAppsScript('updateExpense', { expense });
    await syncWithAppsScript('addTreasuryTransaction', reverseTx);
    await syncWithAppsScript('addTreasuryTransaction', newTx);

    closeModal('edit-expense-modal');
    renderExpenses();
    renderTreasury();
    renderDashboard();
    showToast('✅ تم تعديل المصروف بنجاح', 'success');
  } catch (err) {
    console.error('Error editing expense:', err);
    alert('❌ فشل تعديل المصروف. يرجى المحاولة مرة أخرى.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'حفظ التعديل'; }
  }
});

// طباعة سند صرف مصروف
window.printExpenseReceipt = function(id, mode) {
  const expense = db.expenses.find(e => e.id === id);
  if (!expense) return;
  const companyName = db.settings.companyName || 'شركة SKY';

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>رقم السند:</strong> ${escapeHTML(expense.id)}</div>
        <div><strong>التاريخ:</strong> ${escapeHTML(expense.date)}</div>
      </div>
    </div>
    <div class="print-doc-title">سند صرف مصروف</div>
    <div class="print-doc-row"><span>فئة المصروف</span><strong>${escapeHTML(expense.category)}</strong></div>
    <div class="print-doc-row"><span>المبلغ</span><strong>${Number(expense.amount).toLocaleString()} ج.م</strong></div>
    <div class="print-doc-row"><span>البيان</span><strong>${escapeHTML(expense.description || '—')}</strong></div>
    <div class="print-doc-row"><span>صرف بمعرفة</span><strong>${escapeHTML(expense.paidBy || '—')}</strong></div>
    <div class="print-doc-signatures">
      <div>توقيع المستلم: ______________</div>
      <div>توقيع المدير المالي: ______________</div>
    </div>
    <div class="print-doc-footer">تم إصدار هذا السند إلكترونياً من نظام ${companyName} بتاريخ ${new Date().toLocaleString('ar-EG')}</div>
  `;
  if (mode === 'pdf') {
    downloadHTMLAsPDF(html, `سند-صرف-${escapeHTML(expense.category)}.pdf`);
  } else {
    printHTML(html);
  }
  logAction('طباعة سند صرف', `${mode === 'pdf' ? 'تحميل PDF لـ' : 'طباعة'} سند صرف مصروف رقم ${expense.id} بقيمة ${expense.amount} ج.م`);
};

// طباعة كشف بكل المصروفات المعروضة حالياً (حسب أي فلتر فئة/شهر مُطبّق)
window.printExpensesList = function() {
  const companyName = db.settings.companyName || 'شركة SKY';
  const rows = document.getElementById('expenses-table-body').innerHTML;
  const isEmpty = !document.getElementById('expenses-empty-state').classList.contains('hidden');
  const categoryFilter = document.getElementById('expense-filter-category').value;
  const monthFilter = document.getElementById('expense-filter-month').value;

  let filtered = [...db.expenses];
  if (categoryFilter !== 'all') filtered = filtered.filter(e => e.category === categoryFilter);
  if (monthFilter) filtered = filtered.filter(e => (e.date || '').substring(0, 7) === monthFilter);
  const totalAmount = filtered.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>الفئة:</strong> ${categoryFilter === 'all' ? 'الكل' : escapeHTML(categoryFilter)}</div>
        <div><strong>الشهر:</strong> ${monthFilter ? escapeHTML(monthFilter) : 'الكل'}</div>
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    <div class="print-doc-title">كشف المصروفات</div>
    ${isEmpty ? '<p style="font-size:0.85rem; color:#64748b;">لا توجد مصروفات مطابقة للفلاتر المحددة.</p>' : `
    <table class="print-doc-table">
      <thead><tr><th>التاريخ</th><th>الفئة</th><th>المبلغ</th><th>البيان</th><th>صرف بمعرفة</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="print-doc-row" style="border-top:1px dashed #94a3b8; margin-top:8px; padding-top:8px;">
      <span>إجمالي المصروفات في هذا الكشف</span><strong>${totalAmount.toLocaleString()} ج.م</strong>
    </div>`}
    <div class="print-doc-footer">تم إصدار هذا الكشف إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${new Date().toLocaleString('ar-EG')}</div>
  `;
  printHTML(html);
  logAction('طباعة كشف مصروفات', `طباعة كشف مصروفات (فئة: ${categoryFilter}, شهر: ${monthFilter || 'الكل'})`);
};


window.printAuditLog = function() {
  if (!isAdmin()) {
    showToast('❌ سجل العمليات متاح للمشرف (Admin) فقط.', 'error');
    return;
  }
  const companyName = db.settings.companyName || 'شركة SKY';
  const rows = document.getElementById('audit-log-table-body').innerHTML;
  const isEmpty = !document.getElementById('audit-log-empty-state').classList.contains('hidden');
  const fromDate = document.getElementById('audit-log-from-date').value || '(البداية)';
  const toDate = document.getElementById('audit-log-to-date').value || '(الآن)';

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>الفترة:</strong> ${escapeHTML(fromDate)} إلى ${escapeHTML(toDate)}</div>
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    <div class="print-doc-title">سجل العمليات (Audit Log)</div>
    ${isEmpty ? '<p style="font-size:0.85rem; color:#64748b;">لا توجد عمليات مطابقة للفلاتر المحددة.</p>' : `
    <table class="print-doc-table">
      <thead><tr><th>التاريخ والوقت</th><th>المستخدم</th><th>نوع العملية</th><th>التفاصيل</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`}
    <div class="print-doc-footer">تم إصدار هذا السجل إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${new Date().toLocaleString('ar-EG')}</div>
  `;
  printHTML(html);
};

document.getElementById('audit-log-search-input').addEventListener('input', debouncedSearch('audit-log', renderAuditLog));
document.getElementById('audit-log-from-date').addEventListener('change', renderAuditLog);
document.getElementById('audit-log-to-date').addEventListener('change', renderAuditLog);

// Expenses filters
const expCatFilter = document.getElementById('expense-filter-category');
if (expCatFilter) expCatFilter.addEventListener('change', renderExpenses);
const expMonthFilter = document.getElementById('expense-filter-month');
if (expMonthFilter) expMonthFilter.addEventListener('change', renderExpenses);

// --- 8. SYSTEM SETTINGS ---
function renderSettings() {
  document.getElementById('setting-company-name').value = db.settings.companyName || 'شركة SKY';
  document.getElementById('setting-company-logo-url').value = db.settings.companyLogo || '';
  
  document.getElementById('setting-offline-mode').checked = db.settings.offlineMode;
  document.getElementById('setting-withdrawal-threshold').value = db.settings.withdrawalApprovalThreshold || 0;
  // IMPROVEMENT #6: تحميل مدة تسجيل الخروج التلقائي عند الخمول
  document.getElementById('setting-session-timeout').value = db.settings.sessionTimeoutMinutes || 0;

  const t = db.settings.templates || defaultSeedData.settings.templates;
  document.getElementById('template-reminder').value = t.reminder;
  document.getElementById('template-warning').value = t.warning;
  document.getElementById('template-receipt').value = t.receipt;

  // تحميل صلاحيات دور STAFF الحالية في خانات الاختيار
  const perms = db.settings.staffPermissions || getDefaultStaffPermissions();
  STAFF_PERMISSION_TABS.forEach(tabKey => {
    const checkbox = document.getElementById(`perm-${tabKey}`);
    if (checkbox) checkbox.checked = perms[tabKey] !== false;
  });

  // IMPROVEMENT #3: تحميل صلاحيات دور COLLECTOR الحالية في خانات الاختيار
  const cperms = db.settings.collectorPermissions || getDefaultCollectorPermissions();
  COLLECTOR_PERMISSION_TABS.forEach(tabKey => {
    const checkbox = document.getElementById(`cperm-${tabKey}`);
    if (checkbox) checkbox.checked = cperms[tabKey] === true;
  });
}

// ================= MODAL INTERACTIONS =================
let lastModalTrigger = null;
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    lastModalTrigger = document.activeElement;
    modal.classList.remove('hidden', 'modal-opening');
    void modal.offsetWidth;
    modal.classList.add('modal-opening');
    const firstFocusable = modal.querySelector('button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]');
    if (firstFocusable) setTimeout(() => firstFocusable.focus(), 40);
  }
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    if (lastModalTrigger && typeof lastModalTrigger.focus === 'function') {
      lastModalTrigger.focus();
      lastModalTrigger = null;
    }
  }
};

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (document.getElementById('system-alert-dialog') || document.getElementById('system-prompt-dialog')) return;
  const notificationsPanel = document.getElementById('notifications-panel');
  if (notificationsPanel) {
    event.preventDefault();
    event.stopPropagation();
    notificationsPanel.remove();
    return;
  }
  const openModal = [...document.querySelectorAll('[id$="-modal"]')]
    .filter(modal => !modal.classList.contains('hidden') && modal.getClientRects().length)
    .sort((a, b) => {
      const aZ = Number.parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
      const bZ = Number.parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
      return bZ - aZ;
    })[0];
  if (openModal) {
    if (openModal.id === 'custom-confirm-modal') return;
    event.preventDefault();
    event.stopPropagation();
    closeModal(openModal.id);
    return;
  }
  const sidebar = document.getElementById('app-sidebar');
  if (sidebar && sidebar.classList.contains('sidebar-open')) {
    event.preventDefault();
    event.stopPropagation();
    closeMobileSidebar();
  }
}, true);

// ================= IMAGE UPLOAD =================
function setupFileReader(inputId, tempKey, previewBoxId, statusId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  input.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      tempUploads[tempKey] = e.target.result;
      document.getElementById(statusId).textContent = `تم اختيار: ${file.name}`;
      
      const previewBox = document.getElementById(previewBoxId);
      previewBox.classList.remove('hidden');
      previewBox.querySelector('span').textContent = file.name;
    };
    reader.readAsDataURL(file);
  });
}

setupFileReader('client-card-img', 'clientCardImg', 'client-card-img-preview-box', 'client-card-img-status');
setupFileReader('client-contract-img', 'clientContractImg', 'client-contract-img-preview-box', 'client-contract-img-status');
setupFileReader('guarantor-card-img', 'guarantorCardImg', 'guarantor-card-img-preview-box', 'guarantor-card-img-status');
setupFileReader('guarantor-contract-img', 'guarantorContractImg', 'guarantor-contract-img-preview-box', 'guarantor-contract-img-status');

window.viewDocument = function(inputId) {
  let base64Data = '';
  let filename = '';

  if (inputId === 'client-card-img') {
    base64Data = tempUploads.clientCardImg;
    filename = document.getElementById('client-card-img-preview-box').querySelector('span').textContent;
  } else if (inputId === 'client-contract-img') {
    base64Data = tempUploads.clientContractImg;
    filename = document.getElementById('client-contract-img-preview-box').querySelector('span').textContent;
  } else if (inputId === 'guarantor-card-img') {
    base64Data = tempUploads.guarantorCardImg;
    filename = document.getElementById('guarantor-card-img-preview-box').querySelector('span').textContent;
  } else if (inputId === 'guarantor-contract-img') {
    base64Data = tempUploads.guarantorContractImg;
    filename = document.getElementById('guarantor-contract-img-preview-box').querySelector('span').textContent;
  }

  if (!base64Data) {
    alert('لا توجد صورة مستند لعرضها أو الصورة ليست بصيغة مدعومة للمعاينة.');
    return;
  }

  document.getElementById('preview-modal-img').src = base64Data;
  document.getElementById('preview-modal-title').textContent = filename;
  openModal('image-preview-modal');
};

window.removeDocument = async function(inputId) {
  if (await customConfirm('هل أنت متأكد من حذف هذا المستند؟')) {
    if (inputId === 'client-card-img') {
      tempUploads.clientCardImg = '';
      document.getElementById('client-card-img').value = '';
      document.getElementById('client-card-img-status').textContent = 'لم يتم الرفع';
      document.getElementById('client-card-img-preview-box').classList.add('hidden');
    } else if (inputId === 'client-contract-img') {
      tempUploads.clientContractImg = '';
      document.getElementById('client-contract-img').value = '';
      document.getElementById('client-contract-img-status').textContent = 'لم يتم الرفع';
      document.getElementById('client-contract-img-preview-box').classList.add('hidden');
    } else if (inputId === 'guarantor-card-img') {
      tempUploads.guarantorCardImg = '';
      document.getElementById('guarantor-card-img').value = '';
      document.getElementById('guarantor-card-img-status').textContent = 'لم يتم الرفع';
      document.getElementById('guarantor-card-img-preview-box').classList.add('hidden');
    } else if (inputId === 'guarantor-contract-img') {
      tempUploads.guarantorContractImg = '';
      document.getElementById('guarantor-contract-img').value = '';
      document.getElementById('guarantor-contract-img-status').textContent = 'لم يتم الرفع';
      document.getElementById('guarantor-contract-img-preview-box').classList.add('hidden');
    }
  }
};

document.getElementById('setting-company-logo-file').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    db.settings.companyLogo = e.target.result;
    document.getElementById('setting-company-logo-url').value = 'تم تحميل لوجو محلي كـ Base64';
    applyCompanyBranding();
  };
  reader.readAsDataURL(file);
});

// ================= PRINTING (RECEIPTS & REPORTS) =================
// آلية طباعة عامة: بنحقن أي محتوى HTML جوه #print-area، وبعدها بنستدعي
// window.print() فيفتح المتصفح مربع حوار الطباعة اللي فيه خيار "حفظ كـ PDF"
// بشكل أصلي، من غير أي مكتبة جافاسكريبت خارجية (وبيدعم العربي/RTL بشكل مثالي
// لأنه بيستخدم محرك عرض المتصفح نفسه).
function printHTML(innerHtml) {
  const area = document.getElementById('print-area');
  if (!area) return;
  area.innerHTML = innerHtml;
  setTimeout(() => window.print(), 50);
}

// تحميل نفس محتوى HTML اللي بيتطبع كملف PDF تلقائياً (بدون ما يفتح مربع
// حوار الطباعة). بنستخدم "foreignObjectRendering" بدل الطريقة الافتراضية،
// لأن الطريقة الافتراضية بترسم كل حرف عربي لوحده على الـ canvas فبتقطع
// الحروف المتصلة (زي "ياسر"). الخاصية دي بتخلي المتصفح نفسه يرسم النص
// (بنفس جودة الطباعة العادية) بدل ما html2canvas يحاول يرسمه يدوياً.
function downloadHTMLAsPDF(innerHtml, filename) {
  if (typeof html2pdf === 'undefined') {
    showToast('❌ تعذّر تحميل مكتبة PDF، تأكد من الاتصال بالإنترنت ثم أعد المحاولة.', 'error');
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.setAttribute('dir', 'rtl');
  wrapper.style.cssText = 'direction:rtl; font-family: var(--font-family); color:#000; background:#fff; padding:20px; width:750px;';
  wrapper.innerHTML = innerHtml;
  wrapper.querySelectorAll('.no-print').forEach(el => el.remove());

  showToast('⏳ جاري تجهيز ملف PDF...', 'info');
  html2pdf().set({
    margin: 10,
    filename: filename || `مستند-${Date.now()}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, foreignObjectRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(wrapper).save().then(() => {
    showToast('✅ تم تحميل ملف الـ PDF بنجاح', 'success');
  }).catch(() => {
    showToast('❌ حصل خطأ، جرّب زرار الطباعة واختر "حفظ كـ PDF" كبديل', 'error');
  });
}

// طباعة إيصال تحصيل قسط بعد اعتماده
window.printInstallmentReceipt = function(instId, mode) {
  const inst = db.installments.find(i => i.id === instId);
  if (!inst || inst.status !== 'paid') {
    showToast('❌ لا يمكن طباعة إيصال لقسط غير مسدد بعد.', 'error');
    return;
  }
  const contract = db.contracts.find(c => c.id === inst.contractId);
  const client = db.clients.find(c => c.id === inst.clientId) || {};
  const companyName = db.settings.companyName || 'شركة SKY';

  const remainingOnContract = db.installments
    .filter(i => i.contractId === inst.contractId && i.status !== 'paid')
    .reduce((sum, i) => sum + safeNum(i.amount), 0);

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>رقم الإيصال:</strong> ${escapeHTML(inst.receiptId) || '—'}</div>
        <div><strong>التاريخ:</strong> ${escapeHTML(inst.paidDate) || ''}</div>
      </div>
    </div>
    <div class="print-doc-title">إيصال استلام دفعة قسط</div>
    <div class="print-doc-row"><span>اسم العميل</span><strong>${escapeHTML(inst.clientName)}</strong></div>
    <div class="print-doc-row"><span>رقم الهاتف</span><strong>${escapeHTML(inst.clientPhone)}</strong></div>
    <div class="print-doc-row"><span>رقم العقد</span><strong>${escapeHTML(inst.contractId)}</strong></div>
    <div class="print-doc-row"><span>الجهاز</span><strong>${contract ? escapeHTML(contract.deviceInfo) : '—'}</strong></div>
    <div class="print-doc-row"><span>رقم القسط</span><strong>قسط ${inst.installmentNum} من ${contract ? contract.duration : '—'}</strong></div>
    <div class="print-doc-row"><span>المبلغ المحصَّل</span><strong>${(inst.paidAmount || inst.amount).toLocaleString()} ج.م</strong></div>
    ${inst.delayFines > 0 ? `<div class="print-doc-row"><span>غرامة تأخير مضمّنة</span><strong>${inst.delayFines.toLocaleString()} ج.م</strong></div>` : ''}
    <div class="print-doc-row"><span>المحصّل</span><strong>${escapeHTML(inst.collectorName) || '—'}</strong></div>
    <div class="print-doc-row" style="border-top:1px dashed #94a3b8; margin-top:8px; padding-top:8px;">
      <span>إجمالي المتبقي على العقد بعد هذه الدفعة</span><strong>${remainingOnContract.toLocaleString()} ج.م</strong>
    </div>
    <div class="print-doc-signatures">
      <div>توقيع المحصّل: ______________</div>
      <div>توقيع العميل: ______________</div>
    </div>
    <div class="print-doc-footer">تم إصدار هذا الإيصال إلكترونياً من نظام ${companyName} بتاريخ ${new Date().toLocaleString('ar-EG')}</div>
  `;
  if (mode === 'pdf') {
    downloadHTMLAsPDF(html, `إيصال-قسط-${escapeHTML(inst.clientName)}-${inst.installmentNum}.pdf`);
  } else {
    printHTML(html);
  }
  logAction('طباعة إيصال', `${mode === 'pdf' ? 'تحميل PDF لـ' : 'طباعة'} إيصال تحصيل القسط رقم ${inst.installmentNum} للعقد ${inst.contractId}`);
};

// ================= WHATSAPP INTEGRATION =================
let activeWhatsappPayload = { phone: '', text: '' };

// تطبيع رقم الهاتف لصيغة دولية صالحة لروابط wa.me (بدون + أو مسافات أو أصفار زيادة).
// بيرجع null لو الرقم مش واضح/غير كافي عشان نقدر نحذّر المستخدم بدل ما نبعت لرقم غلط.
function normalizeWhatsappPhone(raw) {
  if (!raw) return null;
  let digits = String(raw).trim().replace(/[^\d+]/g, '');
  if (!digits) return null;

  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (!digits) return null;

  // رقم مصري محلي كامل بصفر البداية: 01xxxxxxxxx (11 رقم)
  if (digits.startsWith('0') && digits.length === 11) {
    return '20' + digits.slice(1);
  }
  // رقم مصري بدون الصفر ولا كود الدولة: 1xxxxxxxxx (10 أرقام)
  if (/^1[0125]\d{8}$/.test(digits)) {
    return '20' + digits;
  }
  // الرقم مكتوب بالفعل بكود الدولة المصري: 201xxxxxxxxx (12 رقم)
  if (digits.startsWith('20') && digits.length === 12) {
    return digits;
  }
  // أي رقم دولي آخر بطول منطقي، نسيبه زي ما هو بدون افتراض إنه مصري
  if (digits.length >= 8 && digits.length <= 15) {
    return digits;
  }
  return null;
}

window.openWhatsappModal = function(instId, templateType, overrideAmount) {
  const inst = db.installments.find(i => i.id === instId);
  if (!inst) return;

  const contract = db.contracts.find(c => c.id === inst.contractId);
  const client = db.clients.find(c => c.id === contract?.clientId);
  if (!client) return;

  const statusInfo = getInstallmentOverdueStatus(inst);
  
  const templates = db.settings.templates || defaultSeedData.settings.templates;
  let templateText = '';
  let targetPhone = client.phone;
  let recipientName = client.name;

  if (templateType === 'reminder') {
    templateText = templates.reminder;
  } else if (templateType === 'warning_client') {
    templateText = templates.warning;
  } else if (templateType === 'receipt') {
    templateText = templates.receipt;
  }

  if (!templateText) {
    templateText = "تنبيه من الشركة بخصوص العقد رقم {{العقد}}.";
  }

  const companyName = db.settings.companyName || 'شركة SKY';

  // FIX: قيمة {{القسط}} في رسالة السداد لازم تعكس المبلغ اللي اتحصّل *فعلاً*
  // في هذه المرة (لو تحصيل جزئي، مثلاً 400 من أصل قسط 800)، مش قيمة القسط
  // الكاملة كل مرة. رسالتي التذكير والإنذار لسه بتوريك المبلغ الكامل
  // المطلوب سداده (ده صح لهم، لأنهم بيطلبوا كل المتبقي).
  const displayedInstallmentAmount = (templateType === 'receipt')
    ? safeNum(overrideAmount != null ? overrideAmount : (inst.paidAmount || inst.amount))
    : inst.amount;

  let resolvedMsg = templateText
    .replace(/{{الاسم}}/g, client.name)
    .replace(/{{القسط}}/g, displayedInstallmentAmount.toLocaleString())
    .replace(/{{التاريخ}}/g, inst.dueDate)
    .replace(/{{العقد}}/g, inst.contractId.replace('con-', ''))
    .replace(/{{الغرامة}}/g, statusInfo.fine.toLocaleString())
    .replace(/{{المطلوب}}/g, statusInfo.totalDue.toLocaleString())
    .replace(/{{الإيصال}}/g, inst.receiptId || '')
    .replace(/{{الضامن}}/g, client.guarantorName || 'لا يوجد')
    .replace(/{{اسم_الشركة}}/g, companyName);

  document.getElementById('wa-recipient-name').value = recipientName;
  document.getElementById('wa-recipient-phone').value = targetPhone;
  document.getElementById('wa-message-text').value = resolvedMsg;

  const formattedPhone = normalizeWhatsappPhone(targetPhone);
  if (!formattedPhone) {
    alert(`رقم هاتف العميل "${recipientName}" غير واضح أو غير مكتمل (${targetPhone || 'فارغ'}). من فضلك عدّل رقم الهاتف من بيانات العميل قبل الإرسال.`);
    return;
  }

  activeWhatsappPayload = {
    phone: formattedPhone,
    text: resolvedMsg
  };

  openModal('whatsapp-modal');
};

window.sendPreparedWhatsapp = function() {
  const editedText = document.getElementById('wa-message-text').value;
  const url = `https://wa.me/${activeWhatsappPayload.phone}?text=${encodeURIComponent(editedText)}`;
  window.open(url, '_blank');
  closeModal('whatsapp-modal');
  logAction('إرسال واتساب', `إرسال رسالة تواصل إلى الهاتف ${activeWhatsappPayload.phone}`);
};

// ================= BULK WHATSAPP OPERATIONS =================
// إرسال بنظام "طابور": بنفتح رسالة واحدة بس في كل مرة، والانتقال للتالي بيحصل
// بضغطة زرار حقيقية من المستخدم. ده بيتفادى مشكلة إن المتصفح بيحجب فتح أكتر
// من نافذة تلقائياً لو اتفتحوا مع بعض عن طريق setTimeout بدون تفاعل مباشر من المستخدم.
let bulkWaQueue = [];
let bulkWaIndex = 0;
let bulkWaSentCount = 0;
let bulkWaSkippedCount = 0;

window.openBulkWhatsappModal = function() {
  const select = document.getElementById('bulk-wa-month-select');
  select.innerHTML = '';
  
  const months = [...new Set(db.installments.map(i => i.dueDate.substring(0, 7)))].sort();
  months.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  });

  if (months.length === 0) {
    alert('لا توجد أقساط مسجلة لجدولة الرسائل الجماعية.');
    return;
  }

  document.getElementById('bulk-wa-step-select').classList.remove('hidden');
  document.getElementById('bulk-wa-step-queue').classList.add('hidden');
  document.getElementById('bulk-wa-step-summary').classList.add('hidden');

  renderBulkClientsList();
  openModal('bulk-whatsapp-modal');
};

function renderBulkClientsList() {
  const month = document.getElementById('bulk-wa-month-select').value;
  const type = document.getElementById('bulk-wa-type-select').value;
  const listContainer = document.getElementById('bulk-wa-clients-list');
  listContainer.innerHTML = '';

  const targetInsts = db.installments.filter(inst => {
    const matchesMonth = inst.dueDate.substring(0, 7) === month;
    const stats = getInstallmentOverdueStatus(inst);
    
    if (type === 'reminder') {
      return matchesMonth && inst.status !== 'paid';
    } else {
      return matchesMonth && inst.status !== 'paid' && stats.overdueDays > 0;
    }
  });

  if (targetInsts.length === 0) {
    listContainer.innerHTML = '<p class="text-slate-400 text-center py-4">لا توجد أقساط مطابقة لهذا الفلتر.</p>';
    document.getElementById('btn-start-bulk-wa').disabled = true;
    return;
  }
  document.getElementById('btn-start-bulk-wa').disabled = false;

  targetInsts.forEach(inst => {
    const div = document.createElement('div');
    div.className = 'flex justify-between items-center bg-white p-2 rounded border border-slate-100';
    div.innerHTML = `
      <div>
        <span class="font-bold text-slate-700">${escapeHTML(inst.clientName)}</span>
        <span class="text-slate-400 font-mono">(${escapeHTML(inst.dueDate)})</span>
      </div>
      <div class="font-mono font-bold text-teal-600">${inst.amount.toLocaleString()} ج.م</div>
    `;
    listContainer.appendChild(div);
  });
}

document.getElementById('bulk-wa-month-select').addEventListener('change', renderBulkClientsList);
document.getElementById('bulk-wa-type-select').addEventListener('change', renderBulkClientsList);

document.getElementById('btn-start-bulk-wa').addEventListener('click', () => {
  const month = document.getElementById('bulk-wa-month-select').value;
  const type = document.getElementById('bulk-wa-type-select').value;

  const targetInsts = db.installments.filter(inst => {
    const matchesMonth = inst.dueDate.substring(0, 7) === month;
    const stats = getInstallmentOverdueStatus(inst);
    if (type === 'reminder') {
      return matchesMonth && inst.status !== 'paid';
    } else {
      return matchesMonth && inst.status !== 'paid' && stats.overdueDays > 0;
    }
  });

  if (targetInsts.length === 0) return;

  // نبني نص كل رسالة مقدماً ونخزنها في طابور، وبعدين نعرض عنصر واحد بس في كل مرة
  bulkWaQueue = targetInsts.map(inst => {
    const stats = getInstallmentOverdueStatus(inst);
    const companyName = db.settings.companyName || 'شركة SKY';
    const templates = db.settings.templates || defaultSeedData.settings.templates;
    const templateText = type === 'reminder' ? templates.reminder : templates.warning;

    const resolvedMsg = templateText
      .replace(/{{الاسم}}/g, inst.clientName)
      .replace(/{{القسط}}/g, inst.amount.toLocaleString())
      .replace(/{{التاريخ}}/g, inst.dueDate)
      .replace(/{{العقد}}/g, inst.contractId.replace('con-', ''))
      .replace(/{{الغرامة}}/g, stats.fine.toLocaleString())
      .replace(/{{المطلوب}}/g, stats.totalDue.toLocaleString())
      .replace(/{{اسم_الشركة}}/g, companyName);

    return {
      clientName: inst.clientName,
      rawPhone: inst.clientPhone,
      phone: normalizeWhatsappPhone(inst.clientPhone),
      text: resolvedMsg
    };
  });

  bulkWaIndex = 0;
  bulkWaSentCount = 0;
  bulkWaSkippedCount = 0;

  document.getElementById('bulk-wa-step-select').classList.add('hidden');
  document.getElementById('bulk-wa-step-summary').classList.add('hidden');
  document.getElementById('bulk-wa-step-queue').classList.remove('hidden');

  renderBulkWaQueueItem();

  logAction('إرسال جماعي', `بدء جلسة إرسال جماعي لشهر ${month} لنوع ${type === 'reminder' ? 'تذكير' : 'إنذار'} (${bulkWaQueue.length} عميل)`);
});

function renderBulkWaQueueItem() {
  // انتهى الطابور بالكامل
  if (bulkWaIndex >= bulkWaQueue.length) {
    document.getElementById('bulk-wa-step-queue').classList.add('hidden');
    document.getElementById('bulk-wa-step-summary').classList.remove('hidden');
    document.getElementById('bulk-wa-sent-count').textContent = bulkWaSentCount;
    document.getElementById('bulk-wa-skipped-count').textContent = bulkWaSkippedCount;
    return;
  }

  const item = bulkWaQueue[bulkWaIndex];
  document.getElementById('bulk-wa-progress-label').textContent = `العميل: ${item.clientName}`;
  document.getElementById('bulk-wa-progress-count').textContent = `${bulkWaIndex + 1} / ${bulkWaQueue.length}`;
  document.getElementById('bulk-wa-progress-bar').style.width = `${Math.round((bulkWaIndex / bulkWaQueue.length) * 100)}%`;

  document.getElementById('bulk-wa-current-name').value = item.clientName;
  document.getElementById('bulk-wa-current-phone').value = item.rawPhone || '';
  document.getElementById('bulk-wa-current-text').value = item.text;

  const warningEl = document.getElementById('bulk-wa-phone-warning');
  const sendBtn = document.getElementById('btn-send-current-bulk-wa');
  if (!item.phone) {
    warningEl.classList.remove('hidden');
    sendBtn.disabled = true;
    sendBtn.classList.add('opacity-50', 'cursor-not-allowed');
  } else {
    warningEl.classList.add('hidden');
    sendBtn.disabled = false;
    sendBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

document.getElementById('btn-send-current-bulk-wa').addEventListener('click', () => {
  const item = bulkWaQueue[bulkWaIndex];
  if (!item || !item.phone) return;

  // نأخذ النص من الـ textarea في حالة المستخدم عدّل فيه يدوياً
  const editedText = document.getElementById('bulk-wa-current-text').value;
  const url = `https://wa.me/${item.phone}?text=${encodeURIComponent(editedText)}`;

  // فتح النافذة هنا بيحصل مباشرة كنتيجة لضغطة المستخدم على الزرار، فمفيش
  // أي احتمال إن المتصفح يحجبها زي ما كان بيحصل مع الحلقة القديمة اللي كانت
  // بتفتح كل النوافذ دفعة واحدة عن طريق setTimeout.
  window.open(url, '_blank');

  bulkWaSentCount++;
  logAction('إرسال واتساب جماعي', `فتح رسالة واتساب للعميل ${item.clientName} (${item.phone})`);

  bulkWaIndex++;
  renderBulkWaQueueItem();
});

document.getElementById('btn-skip-bulk-wa').addEventListener('click', () => {
  const item = bulkWaQueue[bulkWaIndex];
  if (item) {
    bulkWaSkippedCount++;
    logAction('تخطي إرسال واتساب', `تم تخطي العميل ${item.clientName} أثناء الإرسال الجماعي`);
  }
  bulkWaIndex++;
  renderBulkWaQueueItem();
});

// ================= CUSTOM TRANSACTIONAL ACTIONS =================
window.collectInstallmentBtn = async function(instId) {
  const inst = db.installments.find(i => i.id === instId);
  if (!inst) return;

  // منع التحصيل المتكرر: التحقق إذا كان القسط مسدداً بالفعل أو له عهدة معلقة
  if (inst.status === 'paid') {
    showToast('⚠️ هذا القسط مسدد بالفعل.', 'warning');
    return;
  }
  const existingPending = db.collectorCustodies.find(c => c.installmentId === instId && c.status === 'pending');
  if (existingPending) {
    showToast('⚠️ توجد عملية تحصيل معلقة لهذا القسط بانتظار تأكيد الخزينة.', 'warning');
    return;
  }

  const stats = getInstallmentOverdueStatus(inst);
  document.getElementById('collect-installment-id').value = instId;
  document.getElementById('collect-installment-client-name').textContent = inst.clientName;
  document.getElementById('collect-installment-total-due').textContent = stats.totalDue.toLocaleString();
  document.getElementById('collect-installment-amount').value = stats.totalDue;
  document.getElementById('collect-installment-amount').max = stats.totalDue;
  openModal('collect-installment-modal');
};

document.getElementById('collect-installment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn && submitBtn.disabled) return;
  const instId = document.getElementById('collect-installment-id').value;
  const inst = db.installments.find(i => i.id === instId);
  if (!inst) return;

  const stats = getInstallmentOverdueStatus(inst);
  const enteredAmount = parseFloat(document.getElementById('collect-installment-amount').value);

  if (isNaN(enteredAmount) || enteredAmount <= 0) {
    alert('⚠️ من فضلك اكتب مبلغ صحيح أكبر من صفر.');
    return;
  }
  if (enteredAmount > stats.totalDue + 0.01) {
    alert(`⚠️ المبلغ المكتوب أكبر من إجمالي المستحق (${stats.totalDue.toLocaleString()} ج.م).`);
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري التسجيل...'; }
  try {
  const collector = inst.collectorName || 'Khalifa (ADMIN)';
  const receiptId = `REC-${Date.now().toString().slice(-6)}`;
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const isPartial = enteredAmount < stats.totalDue - 0.01;

  const newCustody = {
    id: receiptId,
    installmentId: instId,
    contractId: inst.contractId,
    clientName: inst.clientName,
    collectorName: collector,
    amount: enteredAmount,
    isPartial,
    date: timestamp,
    status: 'pending'
  };

  db.collectorCustodies.unshift(newCustody);
  logAction('تحصيل محلي بالعهد', `قام المحصل ${collector} بتحصيل ${isPartial ? 'دفعة جزئية' : 'عهدة'} بقيمة ${enteredAmount} ج.م من العميل ${inst.clientName} (معلق بانتظار تأكيد الأدمن)`);

  showToast('جاري تسجيل عملية التحصيل...', 'info');
  await syncWithAppsScript('addPendingCustody', newCustody);

  closeModal('collect-installment-modal');
  renderCollections();
  renderTreasury();
  showToast(`✅ تم تسجيل ${isPartial ? 'الدفعة الجزئية' : 'التحصيل'} بانتظار تأكيد الخزينة.`, 'success');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'تسجيل التحصيل'; }
  }
});

document.getElementById('cash-sale-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const selectedDevId = document.getElementById('cash-sale-serial-select').value;
  const clientName = document.getElementById('cash-client-name').value;
  const clientPhone = document.getElementById('cash-client-phone').value;
  const sellingPrice = parseFloat(document.getElementById('cash-sale-price').value);

  const dev = db.inventory.find(d => d.id === selectedDevId);
  if (!dev) return;

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  dev.status = 'sold_cash';
  dev.soldTo = clientName;

  const txId = `tx-cash-${Date.now()}`;
  const cashSaleTx = {
    id: txId,
    timestamp: timestamp,
    type: 'cash_sale',
    amount: sellingPrice,
    // FEATURE: بنسجل تكلفة الجهاز وقت البيع نفسه (مش بنعتمد على costPrice
    // الحالي في المخزون وقت الحساب لاحقاً، عشان لو اتعدلت التكلفة بعدين ميتغيرش
    // هامش ربح عملية بيعت بالفعل من زمان). ده أساس حساب "الربح المُحقَّق فقط".
    costPrice: safeNum(dev.costPrice),
    deviceId: dev.id,
    notes: `بيع كاش فوري للجهاز ${dev.brand} ${dev.name} (SN: ${dev.serial}) للعميل ${clientName} (هاتف: ${clientPhone})`
  };
  db.treasuryTransactions.unshift(cashSaleTx);

  logAction('بيع كاش فوري', `بيع كاش للجهاز ${dev.brand} ${dev.name} بقيمة ${sellingPrice} ج.م للعميل ${clientName}`);
  
  await syncWithAppsScript('cashSale', { 
    devId: selectedDevId, 
    clientName, 
    clientPhone, 
    sellingPrice, 
    timestamp,
    deviceInfo: `${dev.brand} ${dev.name} (SN: ${dev.serial})`,
    transaction: cashSaleTx
  });

  closeModal('cash-sale-modal');
  document.getElementById('cash-sale-form').reset();
  renderInventory();
  renderTreasury();
  renderDashboard();
});

// true لما المستخدم يكون كاتب رقم بنفسه في خانة "القسط الشهري المطلوب".
// في الحالة دي: "الإجمالي بعد الفائدة" = القسط × عدد الشهور (بيتحسب تلقائي
// من الرقمين اللي هو كاتبهم)، و"قيمة الزيادة" بتتظبط تلقائياً عشان توصّل
// لنفس الإجمالي ده. المقدم بعد كده بيتخصم من الإجمالي عشان يطلع "المتبقي" -
// بس وبس، مفيهوش أي إضافة للمقدم في أي حتة من الحساب.
let targetMonthlyManuallySet = false;

document.getElementById('contract-device-select').addEventListener('change', function() {
  const devId = this.value;
  const dev = db.inventory.find(d => d.id === devId);
  if (dev) {
    document.getElementById('calc-cash-price').textContent = `${dev.sellingPrice.toLocaleString()} ج.م`;
    updateContractCalculation();
  }
});

document.getElementById('contract-interest-type').addEventListener('change', function() {
  const interestValueInput = document.getElementById('contract-interest-value');
  if (this.value === 'none') {
    interestValueInput.disabled = true;
    interestValueInput.value = 0;
  } else {
    interestValueInput.disabled = false;
  }
  // المستخدم بيتحكم يدوي في الزيادة دلوقتي، يبقى نلغي وضع "القسط الثابت"
  // عشان منقاطعوش تعديله بإعادة حساب الزيادة تلقائياً فوق اللي هو كاتبه.
  targetMonthlyManuallySet = false;
  updateContractCalculation();
});

document.getElementById('contract-interest-value').addEventListener('input', function() {
  targetMonthlyManuallySet = false;
  updateContractCalculation();
});

document.getElementById('contract-duration').addEventListener('input', function() {
  updateContractCalculation();
});

document.getElementById('contract-down-payment').addEventListener('input', function() {
  updateContractCalculation();
});

document.getElementById('contract-target-monthly').addEventListener('input', function() {
  // المستخدم لمس الخانة بنفسه؛ من دلوقتي رقمه هو اللي هيتعتمد بالظبط ومش
  // هيتغير تلقائياً لحد ما يمسحه هو بنفسه.
  targetMonthlyManuallySet = this.value !== '';
  updateContractCalculation();
});

function calcInterestAmount(cashPrice, interestType, interestValue) {
  if (interestType === 'percent') {
    return cashPrice * (interestValue / 100);
  } else if (interestType === 'fixed') {
    return interestValue;
  }
  return 0;
}

// بيحدّث أرقام الملخص (سعر الكاش / الإجمالي بعد الفائدة / المتبقي / القسط
// الشهري) على حسب وضعين:
//
// 1) وضع "القسط الشهري محدد يدوي" (targetMonthlyManuallySet = true):
//    - الإجمالي بعد الفائدة = القسط × عدد الشهور (زي ما كتبهم المستخدم بالظبط)
//    - قيمة الزيادة بتتحسب تلقائياً = الإجمالي بعد الفائدة - سعر الكاش
//    - المتبقي = الإجمالي بعد الفائدة - المقدم (خصم بسيط، مفيش أي إضافة)
//
// 2) الوضع العادي (المستخدم لسه ما كتبش قسط شهري بنفسه):
//    - الإجمالي بعد الفائدة = سعر الكاش + الزيادة (من نوع/قيمة الزيادة المختارة)
//    - المتبقي = الإجمالي بعد الفائدة - المقدم
//    - القسط الشهري المقترح = المتبقي ÷ عدد الشهور
function updateContractCalculation() {
  const devId = document.getElementById('contract-device-select').value;
  const dev = db.inventory.find(d => d.id === devId);
  if (!dev) return;

  const cashPrice = dev.sellingPrice;
  const downPayment = parseFloat(document.getElementById('contract-down-payment').value) || 0;
  const duration = parseInt(document.getElementById('contract-duration').value) || 1;
  const targetInput = document.getElementById('contract-target-monthly');
  const manualValue = parseFloat(targetInput.value);

  let totalAfterInterest, remaining, monthly;

  if (targetMonthlyManuallySet && !isNaN(manualValue) && manualValue >= 0) {
    monthly = manualValue;
    // في حالة القسط اليدوي، بنفترض إن الإجمالي المتبقي هو القسط × المدة
    // والمقدم بيتحط فوقهم عشان نوصل لإجمالي قيمة العقد
    remaining = parseFloat((monthly * duration).toFixed(2));
    totalAfterInterest = remaining + downPayment;

    // نحسب "الزيادة" اللي تخلي الإجمالي يوصل للرقم ده
    const interestNeeded = parseFloat((totalAfterInterest - cashPrice).toFixed(2));
    const typeSelect = document.getElementById('contract-interest-type');
    const valueInput = document.getElementById('contract-interest-value');
    if (Math.abs(interestNeeded) < 0.01) {
      typeSelect.value = 'none';
      valueInput.value = 0;
      valueInput.disabled = true;
    } else {
      typeSelect.value = 'fixed';
      valueInput.disabled = false;
      valueInput.value = interestNeeded;
    }
  } else {
    const interestType = document.getElementById('contract-interest-type').value;
    const interestValue = parseFloat(document.getElementById('contract-interest-value').value) || 0;
    
    // التعديل المطلوب: خصم المقدم أولاً قبل حساب الفائدة (لو كانت نسبة)
    const amountToFinance = Math.max(0, cashPrice - downPayment);
    const interest = calcInterestAmount(amountToFinance, interestType, interestValue);
    
    remaining = amountToFinance + interest;
    totalAfterInterest = cashPrice + interest; // الإجمالي = سعر الكاش + الفائدة (اللي اتحسبت على الصافي)
    monthly = parseFloat((remaining / duration).toFixed(2));

    if (targetInput) {
      targetInput.value = monthly > 0 ? monthly : '';
    }
  }

  document.getElementById('calc-cash-price').textContent = `${cashPrice.toLocaleString()} ج.م`;
  document.getElementById('calc-total-price').textContent = `${totalAfterInterest.toLocaleString()} ج.م`;
  document.getElementById('calc-remaining-amount').textContent = `${remaining.toLocaleString()} ج.م`;
  document.getElementById('calc-monthly-installment').textContent = `${monthly.toLocaleString()} ج.م`;
}

document.getElementById('add-contract-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  // FIX: حماية من الضغط المزدوج بالغلط (بيحصل كتير على الموبايل أو لما
  // النت يكون بطيء) - كان ممكن يعمل عقدين لنفس العميل بدل عقد واحد.
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn && submitBtn.disabled) return;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الحفظ...'; }
  try {

  const clientId = document.getElementById('contract-client-select').value;
  const deviceId = document.getElementById('contract-device-select').value;
  const duration = parseInt(document.getElementById('contract-duration').value);
  const downPayment = parseFloat(document.getElementById('contract-down-payment').value);
  const graceDays = parseInt(document.getElementById('contract-grace-days').value);
  const fineType = document.getElementById('contract-fine-type').value;
  const fineValue = parseFloat(document.getElementById('contract-fine-value').value);
  const collectorName = document.getElementById('contract-collector-select').value;
  const startDate = document.getElementById('contract-start-date').value;

  const interestType = document.getElementById('contract-interest-type').value;
  const interestValue = parseFloat(document.getElementById('contract-interest-value').value) || 0;

  const client = db.clients.find(c => c.id === clientId);
  const dev = db.inventory.find(d => d.id === deviceId);
  const collector = db.users.find(u => u.name === collectorName);

  if (!client || !dev) {
    alert('العميل أو الجهاز غير متوافق.');
    return;
  }

  const cashPrice = dev.sellingPrice;
  // التعديل المطلوب: خصم المقدم أولاً قبل حساب الفائدة (لو كانت نسبة)
  const amountToFinance = Math.max(0, cashPrice - downPayment);
  const interest = calcInterestAmount(amountToFinance, interestType, interestValue);
  
  const totalValue = cashPrice + interest;
  const contractId = `con-${Math.floor(100000 + Math.random() * 900000)}`;
  const remaining = amountToFinance + interest;

  // لو المستخدم كاتب قسط شهري بنفسه في خانة "القسط الشهري المطلوب"، بنستخدم
  // رقمه ده بالظبط في العقد المحفوظ (مش بنعيد حسابه من المتبقي ÷ المدة).
  const targetMonthlyRaw = parseFloat(document.getElementById('contract-target-monthly').value);
  let monthly = (targetMonthlyManuallySet && !isNaN(targetMonthlyRaw) && targetMonthlyRaw >= 0)
    ? targetMonthlyRaw
    : parseFloat((remaining / duration).toFixed(2));

  // FIX (تقرير الفحص - بند ٤.٣): لو القسط الشهري المكتوب يدوياً كبير جداً
  // (أكبر من المتبقي ÷ المدة بحيث القسط الأخير هيبقى صفر أو سالب)، بنرفض
  // الحفظ ونطلب من المستخدم يصحح الرقم، بدل ما ينتج جدول أقساط غير متوازن.
  const lastInstallmentPreview = parseFloat((remaining - monthly * (duration - 1)).toFixed(2));
  if (targetMonthlyManuallySet && lastInstallmentPreview <= 0) {
    alert(`⚠️ القسط الشهري اللي كتبته (${monthly.toLocaleString()} ج.م) كبير جداً بالنسبة للمبلغ المتبقي (${remaining.toLocaleString()} ج.م) على مدار ${duration} شهر - هيخلي القسط الأخير صفر أو بالسالب. من فضلك اكتب قسط أصغر أو اقفل خيار التحديد اليدوي وخلي النظام يحسبه تلقائياً.`);
    return;
  }

  const contract = {
    id: contractId,
    createdAt: Date.now(),
    clientId: clientId,
    clientName: client.name,
    clientPhone: client.phone,
    deviceId: deviceId,
    deviceInfo: `${dev.brand} ${dev.name}`,
    cashPrice: cashPrice,
    interestType: interestType,
    interestValue: interestValue,
    interestAmount: interest,
    totalValue: totalValue,
    downPayment: downPayment,
    remainingAmount: remaining,
    monthlyInstallment: monthly,
    duration: duration,
    graceDays: graceDays,
    // FEATURE: بنسجل تكلفة الجهاز وقت توقيع العقد نفسه (مش هنعتمد على تكلفة
    // المخزون الحالية وقت الحساب لاحقاً)، عشان نقدر نحسب هامش الربح الحقيقي
    // للعقد ده بدقة تاريخية ثابتة، حتى لو اتغيرت أسعار توريد لاحقة.
    costPrice: safeNum(dev.costPrice),
    fineType: fineType,
    fineValue: fineValue,
    collectorId: collector?.id || 'usr-1',
    collectorName: collectorName,
    startDate: startDate,
    status: 'active'
  };

  db.contracts.unshift(contract);
  dev.status = 'sold_installment';
  dev.soldTo = client.name;

  let start = new Date(startDate);
  for (let i = 1; i <= duration; i++) {
    let dueDate = new Date(start);
    dueDate.setMonth(start.getMonth() + (i - 1));

    // آخر قسط بياخد أي فرق تقريب بسيط متبقي، عشان مجموع كل الأقساط يطابق
    // بالظبط "المبلغ المتبقي على العقد" (مش أقل منه بقروش بسبب التقريب).
    const installmentAmount = (i === duration)
      ? parseFloat((remaining - monthly * (duration - 1)).toFixed(2))
      : monthly;

    db.installments.push({
      id: `${contractId}_${i}`,
      contractId: contractId,
      clientId: clientId,
      clientName: client.name,
      clientPhone: client.phone,
      guarantorName: client.guarantorName,
      guarantorPhone: client.guarantorPhone,
      collectorName: collectorName,
      installmentNum: i,
      amount: installmentAmount,
      dueDate: dueDate.toISOString().split('T')[0],
      status: 'pending',
      paidAmount: 0,
      paidDate: '',
      receiptId: '',
      delayFines: 0
    });
  }

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  
  let downPaymentTx = null;
  if (downPayment > 0) {
    downPaymentTx = {
      id: `tx-dp-${Date.now()}`,
      timestamp: timestamp,
      type: 'collection',
      amount: downPayment,
      notes: `مقدم عقد التقسيط رقم ${contractId.replace('con-', '')} للعميل ${client.name} (جهاز ${dev.brand} ${dev.name})`
    };
    db.treasuryTransactions.unshift(downPaymentTx);
  }

  logAction('إنشاء عقد', `تم إنشاء عقد بيع وتقسيط رقم ${contractId.replace('con-', '')} للعميل ${client.name}`);
  
  await syncWithAppsScript('addContract', { 
    contract, 
    timestamp,
    guarantorName: client.guarantorName,
    guarantorPhone: client.guarantorPhone,
    transaction: downPaymentTx
  });

  closeModal('add-contract-modal');
  document.getElementById('add-contract-form').reset();
  targetMonthlyManuallySet = false;
  document.getElementById('contract-interest-value').disabled = true;
  
  renderContracts();
  renderInventory();
  renderCollections();
  renderTreasury();
  renderDashboard();
  // IMPROVEMENT #5: العقد الرسمي (printFormalContract) أصلاً فيه جدول أقساط
  // كامل بكل مواعيد الاستحقاق، لكن قبل كده كان المستخدم لازم يروح تبويب
  // العقود بعد الحفظ ويدوّر على العقد يدوياً عشان يطبعه. دلوقتي بنعرض عليه
  // مباشرة بعد الحفظ يطبع العقد وجدول السداد الفعلي أو يأجّلها لوقت تاني.
  showContractCreatedDialog(contractId);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'اعتماد العقد والبيع'; }
  }
});

document.getElementById('add-brand-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const categoryId = document.getElementById('brand-category-select').value;
  const name = document.getElementById('brand-name').value.trim();
  if (!name || !categoryId) return;

  // فحص التكرار داخل نفس التصنيف
  if (db.brands.some(b => (typeof b === 'object' ? b.name : b) === name && (typeof b === 'object' ? b.categoryId === categoryId : true))) {
    alert('الماركة مسجلة بالفعل في هذا التصنيف.');
    return;
  }

  const newBrand = {
    id: `brand-${Date.now()}`,
    name,
    categoryId
  };

  db.brands.push(newBrand);
  logAction('إضافة ماركة', `إضافة ماركة ${name} لتصنيف ${db.productCategories.find(c => c.id === categoryId)?.name}`);
  
  await syncWithAppsScript('addBrand', newBrand);
  
  closeModal('add-brand-modal');
  document.getElementById('add-brand-form').reset();
  // كان ناقص: من غير renderProducts() الماركة الجديدة معملتش refresh
  // لشرائط الماركات تحت الصنف (renderProductCategoryChips)، فكانت بتفضل
  // مش ظاهرة في الشاشة غير لو غيّرت الصنف المختار ورجعتله تاني أو عملت Refresh.
  renderProducts();
  populateDropdowns();
});

document.getElementById('add-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!isAdmin()) {
    alert('⛔ إضافة مستخدمين جدد للمشرف (ADMIN) فقط.');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('user-fullname').value.trim();
  const username = document.getElementById('user-username').value.trim();
  const phone = document.getElementById('user-phone').value.trim();
  const password = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;
  const area = document.getElementById('user-area').value.trim();

  if (db.users.some(u => (u.username || '').toLowerCase() === username.toLowerCase())) {
    alert('❌ اسم المستخدم هذا مُستخدم بالفعل، اختر اسماً آخر.');
    return;
  }
  if (password.length < 6) {
    alert('❌ كلمة المرور يجب أن تكون 6 أحرف على الأقل (متطلب Firebase Authentication).');
    return;
  }
  if (!window.FirebaseAuthService) {
    alert('❌ تعذر الاتصال بخدمة Firebase Authentication. تأكد من اتصال الإنترنت.');
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الإنشاء...'; }

  try {
    // إنشاء حساب حقيقي وآمن في Firebase Authentication (بدون التأثير على جلسة الأدمن الحالية)
    const authResult = await window.FirebaseAuthService.createAuthUser(username, password);

    if (!authResult.success) {
      throw new Error('فشل إنشاء حساب المصادقة');
    }

    // ملاحظة أمان هامة: لا يتم تخزين كلمة المرور في Firestore إطلاقاً بعد الآن،
    // فقط authUid الذي يربط ملف المستخدم بحساب Firebase Authentication الحقيقي
    const newUser = {
      id: `usr-${Date.now()}`,
      authUid: authResult.uid,
      name,
      username,
      phone,
      role,
      area
    };

    // FIX: ننشئ مستند userRoles أولاً قبل أي شيء تاني.
    // لو ما عملناش كده، عملية syncWithAppsScript('addUser') هتفشل بسبب
    // إن الـ Rules بتحتاج مستند userRoles للأدمن عشان تسمحله بالكتابة في users.
    // وده هو السبب الجذري للمشكلة اللي بتواجهها.
    if (window.FirebaseAuthService.ensureUserRoleDoc) {
      await window.FirebaseAuthService.ensureUserRoleDoc(authResult.uid, role, name);
    }

    db.users.push(newUser);
    logAction('إضافة مستخدم', `إضافة المستخدم الجديد ${name} بصلاحية ${role}`);
    await syncWithAppsScript('addUser', newUser);

    closeModal('add-user-modal');
    document.getElementById('add-user-form').reset();
    renderUsers();
    populateDropdowns();
    showToast(`✅ تم إنشاء حساب ${escapeHTML(name)} بنجاح عبر Firebase Authentication`, 'success');
  } catch (err) {
    console.error('Error creating user:', err);
    let msg = 'حدث خطأ أثناء إنشاء المستخدم.';
    if (err.code === 'auth/email-already-in-use') {
      msg = '❌ اسم المستخدم هذا مُستخدم بالفعل (مسجل مسبقاً في Firebase Authentication).';
    } else if (err.code === 'auth/weak-password') {
      msg = '❌ كلمة المرور ضعيفة جداً، استخدم 6 أحرف على الأقل.';
    }
    alert(msg);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'حفظ المستخدم'; }
  }
});

// ملاحظة: معالج (submit) الخاص بنموذج إضافة/تعديل المورد تم نقله وتوحيده
// بالكامل ضمن قسم "SUPPLIERS" أعلاه (يدعم الإضافة والتعديل ونوع التعامل).

// يتحقق هل رقم تسلسلي معين موجود بالفعل بالمخزن (بأي حالة: متاح أو مباع) عشان
// نمنع تكرار نفس السيريال بغلط (خصوصاً عند اللصق أو الاستيراد الجماعي).
function isDuplicateSerial(serial, excludeId) {
  const clean = (serial || '').trim().toLowerCase();
  if (!clean) return false;
  return db.inventory.some(d => d.id !== excludeId && (d.serial || '').trim().toLowerCase() === clean);
}

// يضيف حدث جديد لسجل تاريخ الجهاز (Audit Trail على مستوى القطعة نفسها)
function addDeviceHistory(device, action, note) {
  if (!device.history) device.history = [];
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  device.history.unshift({ date: timestamp, action, note: note || '', by: getCurrentUserName() });
}

document.getElementById('add-device-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const catId = document.getElementById('device-category-select').value;
  const brand = document.getElementById('device-brand-select').value;
  const modelId = document.getElementById('device-model-select').value;
  const quantity = parseInt(document.getElementById('device-quantity').value) || 1;
  const serialRaw = document.getElementById('device-serial').value.trim();
  const costPrice = parseFloat(document.getElementById('device-cost').value);
  const sellingPrice = parseFloat(document.getElementById('device-price').value);
  const supplierId = document.getElementById('device-supplier').value;
  const paymentMethod = document.getElementById('device-payment-method').value || 'cash';
  const condition = document.getElementById('device-condition').value || 'new';
  const warrantyMonths = parseInt(document.getElementById('device-warranty').value) || 0;
  const branch = document.getElementById('device-branch').value.trim() || 'الفرع الرئيسي';
  const minQty = parseInt(document.getElementById('device-min-qty').value) || 3;
  const notes = document.getElementById('device-notes').value.trim();

  const modelObj = db.products.find(p => p.id === modelId);
  const name = modelObj ? modelObj.name : 'منتج غير معروف';

  const supplierObj = db.suppliers.find(s => s.id === supplierId);
  if (!supplierObj) {
    alert('⚠️ برجاء اختيار مورد صحيح.');
    return;
  }
  const supplier = supplierObj.name;

  // فحص السيريال لو الكمية 1
  if (quantity === 1 && serialRaw && isDuplicateSerial(serialRaw)) {
    alert(`⚠️ السيريال ${serialRaw} مسجل بالفعل بالمخزون.`);
    return;
  }

  const now = new Date();
  const timestamp = nowTimestamp();
  const todayDate = timestamp.split(' ')[0];

  const totalCost = costPrice * quantity;
  const syncPromises = [];

  for (let i = 0; i < quantity; i++) {
    const serial = (quantity === 1) ? serialRaw : `AUTO-${Date.now()}-${i}`;
    const newDevice = {
      id: `dev-${Date.now()}-${i}`,
      brand,
      name,
      serial,
      costPrice,
      sellingPrice,
      supplier,
      supplierId,
      purchaseMethod: paymentMethod,
      status: 'available',
      soldTo: '',
      condition,
      warrantyMonths,
      branch,
      minQty,
      notes,
      addedDate: todayDate,
      history: []
    };
    addDeviceHistory(newDevice, 'إضافة للمخزن', `تمت إضافة القطعة من المورد ${supplier} (${paymentMethod === 'credit' ? 'آجل' : 'كاش'})`);
    db.inventory.push(newDevice);

    let purchaseTx = null;
    if (paymentMethod === 'cash') {
      purchaseTx = {
        id: `tx-pur-${Date.now()}-${i}`,
        timestamp: timestamp,
        type: 'inventory_purchase',
        amount: -costPrice,
        notes: `شراء قطعة ${brand} ${name} (SN: ${serial}) من التاجر ${supplier}`
      };
      db.treasuryTransactions.unshift(purchaseTx);
    }

    const supplierTx = {
      id: `sptx-${Date.now()}-${i}`,
      supplierId,
      supplierName: supplier,
      type: 'purchase',
      method: paymentMethod,
      amount: costPrice,
      timestamp,
      date: todayDate,
      notes: `شراء قطعة ${brand} ${name} (SN: ${serial})`,
      relatedDeviceId: newDevice.id
    };
    db.supplierTransactions.unshift(supplierTx);

    syncPromises.push(syncWithAppsScript('addDevice', { newDevice, timestamp, transaction: purchaseTx }));
    syncPromises.push(syncWithAppsScript('addSupplierTransaction', { transaction: supplierTx }));
  }

  logAction('إضافة مخزون', `إضافة عدد ${quantity} قطعة من ${brand} ${name} بمجموع تكلفة ${totalCost} ج.م`);

  if (syncPromises.length > 0) {
    await Promise.all(syncPromises);
  }

  closeModal('add-device-modal');
  document.getElementById('add-device-form').reset();
  renderInventory();
  renderTreasury();
  renderDashboard();
  showToast(`✅ تم إضافة ${quantity} قطعة للمخزن بنجاح`, 'success');
});

window.openAddClientModal = function() {
  document.getElementById('client-edit-id').value = '';
  document.getElementById('add-client-form').reset();
  document.getElementById('guarantor-client-results').classList.add('hidden');
  document.getElementById('guarantor-client-risk-warning').classList.add('hidden');
  
  tempUploads = {
    clientCardImg: '',
    clientContractImg: '',
    guarantorCardImg: '',
    guarantorContractImg: ''
  };

  document.getElementById('client-card-img-preview-box').classList.add('hidden');
  document.getElementById('client-contract-img-preview-box').classList.add('hidden');
  document.getElementById('guarantor-card-img-preview-box').classList.add('hidden');
  document.getElementById('guarantor-contract-img-preview-box').classList.add('hidden');

  document.getElementById('client-card-img-status').textContent = 'لم يتم الرفع';
  document.getElementById('client-contract-img-status').textContent = 'لم يتم الرفع';
  document.getElementById('guarantor-card-img-status').textContent = 'لم يتم الرفع';
  document.getElementById('guarantor-contract-img-status').textContent = 'لم يتم الرفع';

  document.getElementById('client-modal-title').textContent = 'إضافة عميل وضامن جديد للمبيعات';
  openModal('add-client-modal');
};

window.editClient = function(clientId) {
  const c = db.clients.find(x => x.id === clientId);
  if (!c) return;

  document.getElementById('client-edit-id').value = c.id;
  document.getElementById('guarantor-client-search').value = '';
  document.getElementById('guarantor-client-picked-id').value = '';
  document.getElementById('guarantor-client-results').classList.add('hidden');
  document.getElementById('guarantor-client-risk-warning').classList.add('hidden');
  
  document.getElementById('client-fullname').value = c.name || '';
  document.getElementById('client-national-id').value = c.nationalId || '';
  document.getElementById('client-phone').value = c.phone || '';
  document.getElementById('client-address').value = c.address || '';
  document.getElementById('client-location-url').value = c.locationUrl || '';

  document.getElementById('guarantor-fullname').value = c.guarantorName || '';
  document.getElementById('guarantor-national-id').value = c.guarantorNationalId || '';
  document.getElementById('guarantor-phone').value = c.guarantorPhone || '';
  document.getElementById('guarantor-relation').value = c.guarantorRelation || '';
  document.getElementById('guarantor-job').value = c.guarantorJob || '';
  document.getElementById('guarantor-address').value = c.guarantorAddress || '';

  tempUploads.clientCardImg = c.nationalIdImg || '';
  tempUploads.clientContractImg = c.contractImg || '';
  tempUploads.guarantorCardImg = c.guarantorCardImg || '';
  tempUploads.guarantorContractImg = c.guarantorContractImg || '';

  setupPreviewBox('client-card-img-preview-box', 'client-card-img-status', c.nationalIdImg, 'بطاقة العميل');
  setupPreviewBox('client-contract-img-preview-box', 'client-contract-img-status', c.contractImg, 'عقد العميل');
  setupPreviewBox('guarantor-card-img-preview-box', 'guarantor-card-img-status', c.guarantorCardImg, 'بطاقة الضامن');
  setupPreviewBox('guarantor-contract-img-preview-box', 'guarantor-contract-img-status', c.guarantorContractImg, 'عقد الضامن');

  document.getElementById('client-modal-title').textContent = 'تعديل بيانات العميل والضامن المعني';
  openModal('add-client-modal');
};

function setupPreviewBox(previewId, statusId, base64Data, label) {
  const box = document.getElementById(previewId);
  const status = document.getElementById(statusId);
  
  if (base64Data && base64Data.startsWith('data:image')) {
    box.classList.remove('hidden');
    box.querySelector('span').textContent = label;
    status.textContent = 'تم توفير مستند مخزن';
  } else {
    box.classList.add('hidden');
    status.textContent = 'لم يتم الرفع';
  }
}

document.getElementById('add-client-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const editId = document.getElementById('client-edit-id').value;

  const name = document.getElementById('client-fullname').value;
  const nationalId = document.getElementById('client-national-id').value;
  const phone = document.getElementById('client-phone').value;
  const address = document.getElementById('client-address').value;
  const locationUrl = document.getElementById('client-location-url').value;
  
  const guarantorName = document.getElementById('guarantor-fullname').value;
  const guarantorNationalId = document.getElementById('guarantor-national-id').value;
  const guarantorPhone = document.getElementById('guarantor-phone').value;
  const guarantorRelation = document.getElementById('guarantor-relation').value;
  const guarantorJob = document.getElementById('guarantor-job').value;
  const guarantorAddress = document.getElementById('guarantor-address').value;

  // FEATURE: تحذير أقوى لو الرقم القومي أو الهاتف موجود في "القائمة
  // السوداء" (أشخاص معروف عنهم مشاكل حتى لو مش عملاء عندك أصلاً). ده أهم
  // وأخطر من تحذير التكرار العادي تحت، فبيتفحص الأول.
  if (!editId) {
    const blacklistMatch = db.blacklist.find(b =>
      (nationalId && b.nationalId && b.nationalId === nationalId) ||
      (phone && b.phone && b.phone === phone)
    );
    if (blacklistMatch) {
      const proceed = await customConfirm(`🚫 تحذير خطير: الشخص ده موجود في القائمة السوداء!\n\nالاسم المسجّل: "${blacklistMatch.name}"\nالسبب: ${blacklistMatch.reason || 'غير مذكور'}\n\nهل أنت متأكد إنك عايز تكمل التسجيل رغم التحذير ده؟`, '🚫 تحذير: قائمة سوداء');
      if (!proceed) return;
    }
  }

  // FEATURE: تحذير لو رقم قومي أو هاتف مطابق لعميل موجود بالفعل (بس عند
  // الإضافة، مش وقت التعديل - عشان تعديل بيانات عميل موجود ميتحسبش تكرار
  // لنفسه). تحذير بس، مش منع، عشان الحالات المشروعة (زي أخوين بنفس الرقم
  // القومي بالغلط في التسجيل القديم) تفضل ممكنة لو الأدمن قرر يكمل.
  if (!editId) {
    const duplicateById = nationalId ? db.clients.find(c => c.nationalId === nationalId) : null;
    const duplicateByPhone = phone ? db.clients.find(c => c.phone === phone) : null;
    if (duplicateById || duplicateByPhone) {
      const messages = [];
      if (duplicateById) messages.push(`نفس الرقم القومي مسجّل مسبقاً للعميل: "${duplicateById.name}"`);
      if (duplicateByPhone && duplicateByPhone.id !== (duplicateById && duplicateById.id)) messages.push(`نفس رقم الهاتف مسجّل مسبقاً للعميل: "${duplicateByPhone.name}"`);
      const proceed = await customConfirm(`⚠️ تنبيه تكرار بيانات:\n\n${messages.join('\n')}\n\nهل أنت متأكد إنك عايز تسجّل عميل جديد بنفس البيانات دي؟`, 'تنبيه: بيانات مكررة');
      if (!proceed) return;
    }
  }

  let nationalIdImg = tempUploads.clientCardImg;
  let contractImg = tempUploads.clientContractImg;
  let guarantorCardImg = tempUploads.guarantorCardImg;
  let guarantorContractImg = tempUploads.guarantorContractImg;

  // Use Firebase Storage if available (uploads and returns secure URL)
  if (window.FirebaseService && window.FirebaseService.isAvailable()) {
    const statusMsg = document.getElementById('client-modal-title');
    const originalTitle = statusMsg.textContent;
    statusMsg.textContent = 'جاري رفع الصور المشفرة... يرجى الانتظار';
    
    nationalIdImg = await window.FirebaseService.uploadImage(nationalIdImg, 'clients/cards', `card_${nationalId}`);
    contractImg = await window.FirebaseService.uploadImage(contractImg, 'clients/contracts', `contract_${nationalId}`);
    guarantorCardImg = await window.FirebaseService.uploadImage(guarantorCardImg, 'guarantors/cards', `gcard_${guarantorNationalId || nationalId}`);
    guarantorContractImg = await window.FirebaseService.uploadImage(guarantorContractImg, 'guarantors/contracts', `gcontract_${guarantorNationalId || nationalId}`);
    
    statusMsg.textContent = originalTitle;
  }

  if (editId) {
    const c = db.clients.find(x => x.id === editId);
    if (c) {
      c.name = name;
      c.nationalId = nationalId;
      c.phone = phone;
      c.address = address;
      c.locationUrl = locationUrl;
      c.nationalIdImg = nationalIdImg;
      c.contractImg = contractImg;
      c.guarantorName = guarantorName;
      c.guarantorNationalId = guarantorNationalId;
      c.guarantorPhone = guarantorPhone;
      c.guarantorRelation = guarantorRelation;
      c.guarantorJob = guarantorJob;
      c.guarantorAddress = guarantorAddress;
      c.guarantorCardImg = guarantorCardImg;
      c.guarantorContractImg = guarantorContractImg;

      logAction('تعديل عميل', `تعديل بيانات العميل ${name} وضامنه ${guarantorName}`);
      await syncWithAppsScript('updateClient', c);
    }
  } else {
    const newClient = {
      id: `cli-${Date.now()}`,
      name,
      nationalId,
      phone,
      address,
      locationUrl,
      nationalIdImg,
      contractImg,
      guarantorName,
      guarantorNationalId,
      guarantorPhone,
      guarantorRelation,
      guarantorJob,
      guarantorAddress,
      guarantorCardImg,
      guarantorContractImg
    };
    db.clients.push(newClient);
    logAction('إضافة عميل', `إضافة العميل الجديد ${name} وضامنه ${guarantorName}`);
    await syncWithAppsScript('addClient', newClient);
  }

  closeModal('add-client-modal');
  document.getElementById('add-client-form').reset();
  renderClients();
  populateDropdowns();
});

document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn && submitBtn.disabled) return;
  const amount = parseFloat(document.getElementById('expense-out-amount').value);
  const category = document.getElementById('expense-out-category').value;
  const notes = document.getElementById('expense-notes').value;

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الصرف...'; }
  try {
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const txId = `tx-exp-${Date.now()}`;
  const expenseTx = {
    id: txId,
    timestamp: timestamp,
    type: 'expense',
    amount: -amount,
    notes: `مصروف (${category}): ${notes}`
  };
  db.treasuryTransactions.unshift(expenseTx);

  logAction('صرف مصروف', `صرف مبلغ ${amount} ج.م كبند مصروفات (${category})`);

  await syncWithAppsScript('addExpense', { amount, category, notes, timestamp, transaction: expenseTx });

  closeModal('expense-modal');
  document.getElementById('expense-form').reset();
  renderTreasury();
  renderDashboard();
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'تأكيد وصرف المبلغ'; }
  }
});

document.getElementById('deposit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('deposit-amount').value);
  const notes = document.getElementById('deposit-notes').value;

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const txId = `tx-dep-${Date.now()}`;
  const depositTx = {
    id: txId,
    timestamp: timestamp,
    type: 'deposit',
    amount: amount,
    notes: notes
  };
  db.treasuryTransactions.unshift(depositTx);

  logAction('إيداع خزينة', `إيداع مبلغ ${amount} ج.م بالخزينة لـ: ${notes}`);

  await syncWithAppsScript('addDeposit', { amount, notes, timestamp, transaction: depositTx });

  closeModal('deposit-modal');
  document.getElementById('deposit-form').reset();
  renderTreasury();
  renderDashboard();
});

window.deleteClient = async function(id) {
  await runWithActionLock(`delete-client-${id}`, async () => {
  const client = db.clients.find(c => c.id === id);
  if (!client) return;

  // FIX: قبل كده كان ممكن تحذف عميل عنده عقد نشط لسه فيه أقساط مستحقة، فتفضل
  // العقود والأقساط دي "يتيمة" (من غير عميل) في النظام - بيكسر عرض تبويبات
  // العقود والتحصيلات وأرصدة العملاء لأي حد يفتحها بعد كده. دلوقتي بنمنع
  // الحذف لو لسه عنده عقد نشط (غير مسدد بالكامل/معلّق/مترقّي) وبنوجّه
  // المستخدم يقفل العقد الأول (تسديد، أو استرجاع الجهاز لو متعثر).
  const activeContracts = db.contracts.filter(c =>
    c.clientId === id && c.status !== 'settled_early' && c.status !== 'defaulted' && c.status !== 'upgraded'
  ).filter(c => computeContractBalance(c).totalRemaining > 0.01);

  if (activeContracts.length > 0) {
    alert(`⛔ لا يمكن حذف العميل "${client.name}" لأن له ${activeContracts.length} عقد نشط لسه فيه أقساط مستحقة (${activeContracts.reduce((s, c) => s + computeContractBalance(c).totalRemaining, 0).toLocaleString()} ج.م). لازم أولاً تقفل العقد/العقود دي (تسديد كامل، أو "استرجاع الجهاز" من تبويب العقود لو العميل متعثر) قبل حذف العميل.`);
    return;
  }

  if (await customConfirm('هل أنت متأكد من حذف هذا العميل نهائياً من النظام؟ لا يمكن الرجوع عن هذا الخيار.')) {
    db.clients = db.clients.filter(c => c.id !== id);
    logAction('حذف عميل', `حذف العميل ${client.name} من السجلات`);
    renderClients();
    populateDropdowns();
    // لازم نبعت أمر الحذف الفعلي لقاعدة البيانات، وإلا هيرجع العميل تاني أول ما تحصل أي مزامنة لحظية
    await syncWithAppsScript('deleteClient', { id });
  }
  });
};

window.deleteTransaction = async function(id) {
  await runWithActionLock(`delete-transaction-${id}`, async () => {
  if (!isAdmin()) {
    alert('⛔ حذف الحركات المالية مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  
  const tx = db.treasuryTransactions.find(t => t.id === id);
  if (!tx) return;

  if (await customConfirm(`⚠️ هل أنت متأكد من حذف هذه الحركة المالية بقيمة ${tx.amount} ج.م؟\n\nتنبيه: إذا كانت هذه الحركة مرتبطة بتحصيل قسط، سيتم إرجاع حالة القسط لـ "غير مسدد" تلقائياً.`)) {
    
    // لو الحركة هي تحصيل قسط، نرجع القسط لحالته الأصلية
    if (tx.type === 'collection' && tx.installmentId) {
      const inst = db.installments.find(i => i.id === tx.installmentId);
      if (inst) {
        inst.status = 'pending';
        inst.paidAmount = 0;
        inst.paidDate = '';
        inst.delayFines = 0;
        inst.receiptId = '';
        logAction('تعديل قسط (عكسي)', `إرجاع القسط ${inst.id} لغير مسدد بسبب حذف حركة الخزينة`);
        await syncWithAppsScript('updateInstallment', inst);
      }
    }

    db.treasuryTransactions = db.treasuryTransactions.filter(t => t.id !== id);
    logAction('حذف حركة مالية', `حذف المعاملة المالية بقيمة ${tx.amount} ج.م وتصحيح التبعات المالية`);
    
    renderTreasury();
    renderCollections();
    renderDashboard();
    await syncWithAppsScript('deleteTransaction', { id });
    showToast('✅ تم حذف الحركة المالية وتصحيح البيانات المرتبطة بنجاح', 'success');
  }
  });
};

window.editTransaction = function(id) {
  if (!isAdmin()) {
    alert('⛔ تعديل الحركات المالية مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  const tx = db.treasuryTransactions.find(t => t.id === id);
  if (!tx) return;

  document.getElementById('edit-tx-id').value = tx.id;
  document.getElementById('edit-tx-amount').value = Math.abs(tx.amount);
  document.getElementById('edit-tx-notes').value = tx.notes;
  openModal('edit-transaction-modal');
};

window.saveTransactionEdit = async function() {
  await runWithActionLock("save-transaction-edit", async () => {
  if (!isAdmin()) return;
  const id = document.getElementById('edit-tx-id').value;
  const tx = db.treasuryTransactions.find(t => t.id === id);
  if (!tx) return;

  const newAmt = parseFloat(document.getElementById('edit-tx-amount').value);
  const newNotes = document.getElementById('edit-tx-notes').value.trim();

  tx.amount = tx.amount < 0 ? -Math.abs(newAmt) : Math.abs(newAmt);
  tx.notes = newNotes;

  logAction('تعديل حركة مالية', `تعديل حركة مالية رقم ${id} بقيمة جديدة ${tx.amount} ج.م`);
  closeModal('edit-transaction-modal');
  renderTreasury();
  renderDashboard();
  await syncWithAppsScript('updateTransaction', { id, amount: tx.amount, notes: tx.notes });
  });
};

window.deleteUser = async function(id) {
  await runWithActionLock(`delete-user-${id}`, async () => {
  if (!isAdmin()) {
    alert('⛔ حذف المستخدمين مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  if (currentUser && currentUser.id === id) {
    alert('⛔ لا يمكنك حذف حسابك الخاص وأنت مسجل دخول.');
    return;
  }
  try {
    if (await customConfirm('هل أنت متأكد من حذف هذا المستخدم؟\n\nملاحظة أمنية: سيتم حذف ملف المستخدم من النظام فوراً وفقدانه صلاحية الوصول لبياناته، لكن حساب الدخول الخاص به في Firebase Authentication سيظل موجوداً تقنياً (Firebase لا يسمح بحذف حسابات أخرى من المتصفح لأسباب أمنية). لحذفه نهائياً توجه لـ Firebase Console > Authentication.')) {
      const user = db.users.find(u => u.id === id);
      db.users = db.users.filter(u => u.id !== id);
      if (user) logAction('حذف مستخدم', `حذف المستخدم ${user.name}`);
      renderUsers();
      populateDropdowns();
      await syncWithAppsScript('deleteUser', { id, authUid: user ? (user.authUid || null) : null });
      showToast('✅ تم حذف المستخدم بنجاح', 'success');
    }
  } catch (err) {
    console.error('خطأ أثناء حذف المستخدم:', err);
    alert('❌ حصل خطأ غير متوقع أثناء الحذف. افتح Console بالمتصفح (F12) وابعتلي رسالة الخطأ اللي ظهرت.');
  }
  });
};

window.editContract = function(contractId) {
  if (!isAdmin()) {
    alert('⛔ تعديل العقود مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  const c = db.contracts.find(x => x.id === contractId);
  if (!c) return;

  const contractInsts = db.installments.filter(i => i.contractId === c.id);
  const paidCount = contractInsts.filter(i => i.status === 'paid').length;

  document.getElementById('edit-contract-id').value = c.id;
  document.getElementById('edit-contract-client-name').value = c.clientName || '';
  document.getElementById('edit-contract-client-phone').value = c.clientPhone || '';
  document.getElementById('edit-contract-device-info').value = c.deviceInfo || '';
  document.getElementById('edit-contract-cash-price').value = c.cashPrice || 0;
  document.getElementById('edit-contract-interest-type').value = c.interestType || 'none';
  document.getElementById('edit-contract-interest-value').value = c.interestValue || 0;
  document.getElementById('edit-contract-down-payment').value = c.downPayment || 0;
  document.getElementById('edit-contract-duration').value = c.duration || contractInsts.length || 1;
  document.getElementById('edit-contract-start-date').value = c.startDate || '';
  document.getElementById('edit-contract-collector').value = c.collectorName || '';
  document.getElementById('edit-contract-grace').value = c.graceDays || 5;
  document.getElementById('edit-contract-fine-type').value = c.fineType || 'flat';
  document.getElementById('edit-contract-fine-value').value = c.fineValue || 0;
  document.getElementById('edit-contract-status').value = c.status || 'active';

  const paidInfoBox = document.getElementById('edit-contract-paid-info');
  const paidInfoText = document.getElementById('edit-contract-paid-info-text');
  if (paidCount > 0) {
    paidInfoBox.classList.remove('hidden');
    paidInfoText.textContent = `تم تحصيل ${paidCount} من أصل ${contractInsts.length} قسط لهذا العقد بالفعل. لو غيّرت القيم المالية (السعر/المقدم/الفائدة/المدة)، هيتم إعادة توليد الأقساط المتبقية فقط بالقيم الجديدة، ولن يتم المساس بالأقساط المسددة.`;
  } else {
    paidInfoBox.classList.add('hidden');
  }

  openModal('edit-contract-modal');
};

window.saveContractEdit = async function() {
  await runWithActionLock("save-contract-edit", async () => {
  if (!isAdmin()) return;
  const contractId = document.getElementById('edit-contract-id').value;
  const c = db.contracts.find(x => x.id === contractId);
  if (!c) return;

  try {
    const newClientName = document.getElementById('edit-contract-client-name').value.trim();
    const newClientPhone = document.getElementById('edit-contract-client-phone').value.trim();
    const newDeviceInfo = document.getElementById('edit-contract-device-info').value.trim();
    const newCashPrice = parseFloat(document.getElementById('edit-contract-cash-price').value) || 0;
    const newInterestType = document.getElementById('edit-contract-interest-type').value;
    const newInterestValue = parseFloat(document.getElementById('edit-contract-interest-value').value) || 0;
    const newDownPayment = parseFloat(document.getElementById('edit-contract-down-payment').value) || 0;
    const newDuration = parseInt(document.getElementById('edit-contract-duration').value) || c.duration;
    const newStartDate = document.getElementById('edit-contract-start-date').value || c.startDate;
    const newCollector = document.getElementById('edit-contract-collector').value.trim();
    const newGrace = parseInt(document.getElementById('edit-contract-grace').value) || 5;
    const newFineType = document.getElementById('edit-contract-fine-type').value;
    const newFineValue = parseFloat(document.getElementById('edit-contract-fine-value').value) || 0;
    const newStatus = document.getElementById('edit-contract-status').value;

    const contractInsts = db.installments.filter(i => i.contractId === c.id);
    const paidInsts = contractInsts.filter(i => i.status === 'paid');
    const paidCount = paidInsts.length;
    const paidSum = paidInsts.reduce((sum, i) => sum + safeNum(i.paidAmount || i.amount), 0);

    const financialChanged = (
      newCashPrice !== c.cashPrice ||
      newInterestType !== c.interestType ||
      newInterestValue !== c.interestValue ||
      newDownPayment !== c.downPayment ||
      newDuration !== c.duration
    );

    // FIX: تعديل تاريخ بداية العقد لوحده (من غير أي تغيير في السعر/الفائدة/
    // المقدم/المدة) كان قبل كده بيتجاهَل تماماً، لأن financialChanged ماكانتش
    // بتشمل التاريخ، فمكانتش بتشغّل إعادة توليد الأقساط أبداً. دلوقتي أي
    // تغيير في التاريخ بيتحسب برضه كسبب لإعادة توليد الأقساط المتبقية.
    const startDateChanged = newStartDate !== c.startDate;
    const needsRegeneration = financialChanged || startDateChanged;

    if (financialChanged) {
      if (newDuration <= paidCount) {
        alert(`❌ لا يمكن ضبط مدة التقسيط على ${newDuration} شهر لأن العميل سدد بالفعل ${paidCount} قسط. اختر مدة أكبر من ${paidCount}.`);
        return;
      }
      const remainingCountPreview = newDuration - paidCount;
      if (!(await customConfirm(`⚠️ تنبيه هام:\n\nتعديل القيم المالية للعقد سيؤدي إلى:\n• حذف الأقساط "غير المسددة" الحالية (${contractInsts.length - paidCount} قسط)\n• إعادة توليد ${remainingCountPreview} قسط جديد بالقيم المحدّثة\n• الأقساط المسددة فعلاً (${paidCount}) لن تتأثر إطلاقاً\n\nهل أنت متأكد من المتابعة؟`))) {
        return;
      }
    } else if (startDateChanged) {
      // تغيير التاريخ لوحده من غير أي تغيير مالي - برضه بيعيد توليد مواعيد
      // الأقساط غير المسددة، فلازم نوضح ده للمستخدم قبل ما يكمل.
      const remainingCountPreview = newDuration - paidCount;
      if (!(await customConfirm(`⚠️ تنبيه:\n\nتعديل تاريخ بداية العقد سيؤدي إلى إعادة حساب مواعيد استحقاق الأقساط "غير المسددة" الحالية (${remainingCountPreview} قسط) بناءً على التاريخ الجديد.\n• الأقساط المسددة فعلاً (${paidCount}) لن تتأثر إطلاقاً\n\nهل أنت متأكد من المتابعة؟`))) {
        return;
      }
    }

    // التعديل المطلوب: خصم المقدم أولاً قبل حساب الفائدة (لو كانت نسبة)
    const amountToFinance = Math.max(0, newCashPrice - newDownPayment);
    const interest = calcInterestAmount(amountToFinance, newInterestType, newInterestValue);
    
    const totalValue = newCashPrice + interest;
    const remainingCount = Math.max(1, newDuration - paidCount);
    
    // المتبقي = (المبلغ الممول + الفائدة) - ما تم سداده بالفعل من أقساط
    const remainingAmount = Math.max(0, (amountToFinance + interest) - paidSum);
    const monthly = parseFloat((remainingAmount / remainingCount).toFixed(2));

    const client = db.clients.find(cl => cl.id === c.clientId);

    c.clientName = newClientName || c.clientName;
    c.clientPhone = newClientPhone || c.clientPhone;
    c.deviceInfo = newDeviceInfo || c.deviceInfo;
    c.cashPrice = newCashPrice;
    c.interestType = newInterestType;
    c.interestValue = newInterestValue;
    c.interestAmount = interest;
    c.totalValue = totalValue;
    c.downPayment = newDownPayment;
    c.duration = newDuration;
    c.startDate = newStartDate;
    c.collectorName = newCollector;
    c.graceDays = newGrace;
    c.fineType = newFineType;
    c.fineValue = newFineValue;
    c.status = newStatus;

    const collectorUser = db.users.find(u => u.name === newCollector);
    if (collectorUser) c.collectorId = collectorUser.id;

    let newInstallments = [];
    if (needsRegeneration) {
      c.remainingAmount = remainingAmount;
      c.monthlyInstallment = monthly;

      // نحذف الأقساط غير المسددة فقط، ونحتفظ بالمسددة كما هي دون أي تعديل
      db.installments = db.installments.filter(i => !(i.contractId === c.id && i.status !== 'paid'));

      // FIX: بنستخدم دايماً تاريخ البداية الجديد (newStartDate) كأساس لحساب
      // تواريخ الأقساط المتبقية - بنفس المعادلة المستخدمة بالظبط عند إنشاء
      // عقد جديد (dueDate = تاريخ البداية + (رقم القسط - 1) شهر)، عشان
      // التعديل يتصرف تماماً زي إنشاء عقد جديد وأي تعديل في التاريخ ينعكس
      // فوراً على شهر ويوم كل الأقساط المتبقية. الأقساط المسددة فعلاً مش
      // بتتغير تواريخها إطلاقاً (بيانات تاريخية محفوظة زي ما هي).
      // (قبل كده كان بيتجاهل التاريخ المُعدَّل تماماً لو فيه أقساط مسددة،
      // ولو مفيش أقساط مسددة كان فيه فرق شهر كامل عن معادلة الإنشاء الأصلية)
      const baseDate = new Date(newStartDate);

      for (let i = 1; i <= remainingCount; i++) {
        const installmentNumber = paidCount + i;
        const dueDate = new Date(baseDate);
        dueDate.setMonth(baseDate.getMonth() + (installmentNumber - 1));
        const inst = {
          id: `${c.id}_${installmentNumber}`,
          contractId: c.id,
          clientId: c.clientId,
          clientName: c.clientName,
          clientPhone: c.clientPhone,
          guarantorName: client ? client.guarantorName : '',
          guarantorPhone: client ? client.guarantorPhone : '',
          collectorName: c.collectorName,
          installmentNum: installmentNumber,
          amount: monthly,
          dueDate: dueDate.toISOString().split('T')[0],
          status: 'pending',
          paidAmount: 0,
          paidDate: '',
          receiptId: '',
          delayFines: 0
        };
        db.installments.push(inst);
        newInstallments.push(inst);
      }
    } else {
      // مفيش تغيير مالي ولا في التاريخ: بس نحدّث بيانات العميل/المحصل المنسوخة على الأقساط الحالية
      db.installments.forEach(inst => {
        if (inst.contractId === c.id) {
          inst.collectorName = c.collectorName;
          inst.clientName = c.clientName;
          inst.clientPhone = c.clientPhone;
        }
      });
    }

    logAction('تعديل عقد', `تعديل بيانات العقد رقم ${contractId.replace('con-', '')} للعميل ${c.clientName}`);

    await syncWithAppsScript('updateContract', c);
    if (needsRegeneration) {
      await syncWithAppsScript('regenerateInstallments', { contractId: c.id, installments: newInstallments });
    }

    closeModal('edit-contract-modal');
    renderContracts();
    renderCollections();
    if (typeof renderDashboard === 'function') renderDashboard();
    showToast('✅ تم حفظ تعديلات العقد بنجاح', 'success');
  } catch (err) {
    console.error('خطأ أثناء حفظ تعديلات العقد:', err);
    alert('❌ حصل خطأ غير متوقع أثناء حفظ التعديلات. افتح Console بالمتصفح (F12) وابعتلي رسالة الخطأ اللي ظهرت.');
  }
  });
};


window.deleteContract = async function(contractId) {
  await runWithActionLock(`delete-contract-${contractId}`, async () => {
  if (!isAdmin()) {
    alert('⛔ حذف العقود مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  const c = db.contracts.find(x => x.id === contractId);
  if (!c) return;

  if (await customConfirm(`⚠️ هل أنت متأكد من حذف العقد رقم ${contractId.replace('con-', '')} للعميل ${c.clientName}؟\n\nسيتم:\n• حذف العقد وجميع أقساطه\n• إرجاع الجهاز للمخزن كمتاح\n• رد المقدم والتحصيلات السابقة من الخزينة تلقائياً\n• تنظيف عهد المحصلين المرتبطة بالعقد.`)) {
    
    // 1. إرجاع الجهاز للمخزن
    const dev = db.inventory.find(d => d.id === c.deviceId);
    if (dev) {
      dev.status = 'available';
      dev.soldTo = '';
      addDeviceHistory(dev, 'إلغاء عقد', `تم إرجاع القطعة للمخزن بسبب حذف العقد رقم ${contractId}`);
      await syncWithAppsScript('updateDevice', dev);
    }

    // 2. رد المقدم من الخزينة
    if (c.downPayment > 0) {
      const refundTx = {
        id: `tr-rev-dp-${Date.now()}`,
        type: 'out',
        amount: -parseFloat(c.downPayment), // قيمة سالبة لخصمها من الخزينة
        notes: `رد مقدم العقد المحذوف رقم ${contractId} للعميل ${c.clientName}`,
        timestamp: nowTimestamp()
      };
      db.treasuryTransactions.unshift(refundTx);
      await syncWithAppsScript('addTreasuryTransaction', refundTx);
    }

    // 3. رد الأقساط المحصلة فعلياً من الخزينة
    const contractInsts = db.installments.filter(inst => inst.contractId === contractId);
    const paidInsts = contractInsts.filter(inst => inst.status === 'paid');
    
    for (const inst of paidInsts) {
      const refundInstTx = {
        id: `tr-rev-inst-${Date.now()}-${inst.id}`,
        type: 'out',
        amount: -parseFloat(inst.paidAmount || inst.amount),
        notes: `رد قسط محصل (رقم ${inst.installmentNum}) لعقد محذوف رقم ${contractId}`,
        timestamp: nowTimestamp()
      };
      db.treasuryTransactions.unshift(refundInstTx);
      await syncWithAppsScript('addTreasuryTransaction', refundInstTx);
    }

    // 4. حذف العهد المرتبطة بالعقد (المعلقة والمعتمدة)
    db.collectorCustodies = db.collectorCustodies.filter(cust => cust.contractId !== contractId);

    // 5. حذف الأقساط والعقد
    db.installments = db.installments.filter(inst => inst.contractId !== contractId);
    db.contracts = db.contracts.filter(x => x.id !== contractId);
    
    logAction('حذف عقد ذكي', `حذف العقد ${contractId} وتصحيح المخزن (إرجاع جهاز) والخزينة (رد مقدم وأقساط) وتنظيف العهد`);
    
    await syncWithAppsScript('deleteContract', { id: contractId, deviceId: c.deviceId });
    
    renderContracts();
    renderInventory();
    renderTreasury();
    renderCollections();
    renderDashboard();
    showToast('✅ تم حذف العقد وتصحيح المخزن والخزينة وتنظيف العهد بنجاح', 'success');
  }
  });
};

// ================= SELECT MENUS & SEARCH FILTERS =================
window.updateBrandList = function() {
  const catId = document.getElementById('device-category-select').value;
  const brandSelect = document.getElementById('device-brand-select');
  brandSelect.innerHTML = '<option value="">اختر الماركة...</option>';
  
  const brands = db.brands.filter(b => typeof b === 'object' && b.categoryId === catId);
  brands.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.name;
    opt.textContent = b.name;
    brandSelect.appendChild(opt);
  });
  updateDeviceModelList();
};

window.updateBrandDropdownForProduct = function() {
  const catId = document.getElementById('product-category-select').value;
  const brandSelect = document.getElementById('product-brand-select');
  brandSelect.innerHTML = '<option value="">اختر الماركة...</option>';
  
  const brands = db.brands.filter(b => typeof b === 'object' && b.categoryId === catId);
  brands.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.name;
    opt.textContent = b.name;
    brandSelect.appendChild(opt);
  });
};

window.updateDeviceModelList = function() {
  const catId = document.getElementById('device-category-select').value;
  const brand = document.getElementById('device-brand-select').value;
  const modelSelect = document.getElementById('device-model-select');
  modelSelect.innerHTML = '<option value="">اختر الموديل...</option>';
  
  const models = db.products.filter(p => p.categoryId === catId && p.brand === brand);
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    // تخزين السعر الافتراضي في الـ data attribute
    opt.dataset.cost = m.costPrice || 0;
    opt.dataset.price = m.sellingPrice || 0;
    modelSelect.appendChild(opt);
  });
};

// تحديث الأسعار تلقائياً عند اختيار الموديل
document.addEventListener('change', (e) => {
  if (e.target.id === 'device-model-select') {
    const opt = e.target.options[e.target.selectedIndex];
    if (opt && opt.dataset.cost) {
      document.getElementById('device-cost').value = opt.dataset.cost;
      document.getElementById('device-price').value = opt.dataset.price;
    }
  }
});

window.toggleSerialInput = function() {
  const qty = parseInt(document.getElementById('device-quantity').value) || 1;
  const serialBox = document.getElementById('serial-input-box');
  if (qty > 1) {
    serialBox.classList.add('opacity-50');
    document.getElementById('device-serial').placeholder = "السيريال غير مطلوب للكميات الكبيرة";
  } else {
    serialBox.classList.remove('opacity-50');
    document.getElementById('device-serial').placeholder = "مثال: SN-100201";
  }
};

// ================= بحث قابل للاختيار (Searchable Select) =================
// مكوّن عام قابل لإعادة الاستخدام: يستبدل أي قائمة <select> طويلة (عملاء/
// أجهزة/موردين) بمربع بحث حي يفلتر النتائج وهي بتتكتب، بدل ما المستخدم
// يسكرول في قائمة طويلة يدوّر فيها. القيمة النهائية بتتخزن في input مخفي
// بنفس الـ id اللي كان للـ <select> القديم، فكل الكود التاني اللي بيقرا
// .value منه (submit handlers، checkClientRiskWarning...) يفضل شغال زي ما
// هو من غير أي تعديل تاني.
function setupSearchableSelect({ searchInputId, hiddenInputId, resultsId, getItems, renderLabel, renderSubLabel, onChange }) {
  const searchInput = document.getElementById(searchInputId);
  const hiddenInput = document.getElementById(hiddenInputId);
  const resultsEl = document.getElementById(resultsId);
  if (!searchInput || !hiddenInput || !resultsEl) return;

  function renderResults(query) {
    const items = getItems(query);
    if (items.length === 0) {
      resultsEl.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">مفيش نتائج مطابقة</div>`;
    } else {
      resultsEl.innerHTML = items.slice(0, 50).map(item => `
        <div class="searchable-select-item p-2.5 hover:bg-sky-50 cursor-pointer text-sm border-b border-slate-50 last:border-0" data-id="${escapeHTML(String(item.id))}">
          <div class="font-semibold text-slate-800">${escapeHTML(renderLabel(item))}</div>
          ${renderSubLabel ? `<div class="text-xs text-slate-400">${escapeHTML(renderSubLabel(item))}</div>` : ''}
        </div>
      `).join('');
    }
    resultsEl.classList.remove('hidden');

    resultsEl.querySelectorAll('.searchable-select-item').forEach(el => {
      // mousedown مش click عشان ينفذ قبل ما الـ blur يقفل القائمة
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const id = el.dataset.id;
        const item = items.find(i => String(i.id) === String(id));
        if (!item) return;
        hiddenInput.value = item.id;
        searchInput.value = renderLabel(item);
        resultsEl.classList.add('hidden');
        // بنطلق حدث 'change' حقيقي على الـ input المخفي، عشان أي كود تاني في
        // البرنامج مرتبط بـ addEventListener('change', ...) على العنصر ده
        // (زي تحديث سعر الجهاز المعروض عند اختيار جهاز) يفضل شغال زي ما هو
        // من غير ما نضطر نكرر نفس المنطق هنا. تغيير .value برمجيًا لوحده
        // مبيطلقش حدث change تلقائيًا في الجافاسكريبت العادي.
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        if (onChange) onChange(item);
      });
    });
  }

  searchInput.addEventListener('input', () => {
    // أي تعديل يدوي في مربع البحث بعد اختيار سابق يلغي الاختيار القديم لحد
    // ما المستخدم يختار عنصر تاني من القائمة، عشان مايفضلش فيه ID قديم مخزن
    // من غير ما يطابق النص الظاهر فعليًا في المربع.
    hiddenInput.value = '';
    renderResults(searchInput.value.trim());
  });
  searchInput.addEventListener('focus', () => renderResults(searchInput.value.trim()));
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !resultsEl.contains(e.target)) {
      resultsEl.classList.add('hidden');
    }
  });
}

// تجهيز الثلاثة أماكن اللي كانت قوائم <select> طويلة: عميل العقد، جهاز
// العقد، ومورد التوريد. بيتنفذ مرة واحدة بس عند تحميل السكريبت (العناصر
// موجودة في index.html من البداية).
setupSearchableSelect({
  searchInputId: 'contract-client-search',
  hiddenInputId: 'contract-client-select',
  resultsId: 'contract-client-results',
  getItems: (query) => {
    const q = query.toLowerCase();
    const list = !q ? db.clients : db.clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) || (c.nationalId || '').includes(q) || (c.phone || '').includes(q)
    );
    return list.slice(0, 200);
  },
  renderLabel: (c) => c.name,
  renderSubLabel: (c) => `الهوية: ${c.nationalId} — هاتف: ${c.phone}`,
  onChange: () => { if (typeof checkClientRiskWarning === 'function') checkClientRiskWarning(); }
});

setupSearchableSelect({
  searchInputId: 'contract-device-search',
  hiddenInputId: 'contract-device-select',
  resultsId: 'contract-device-results',
  getItems: (query) => {
    const q = query.toLowerCase();
    const available = db.inventory.filter(d => d.status === 'available');
    const list = !q ? available : available.filter(d =>
      (d.name || '').toLowerCase().includes(q) || (d.brand || '').toLowerCase().includes(q) || (d.serial || '').toLowerCase().includes(q)
    );
    return list.slice(0, 200);
  },
  renderLabel: (d) => `${d.brand} ${d.name} (SN: ${d.serial})`,
  renderSubLabel: (d) => `سعر البيع: ${safeNum(d.sellingPrice).toLocaleString()} ج.م`
});

setupSearchableSelect({
  searchInputId: 'stock-in-supplier-search',
  hiddenInputId: 'stock-in-supplier',
  resultsId: 'stock-in-supplier-results',
  getItems: (query) => {
    const q = query.toLowerCase();
    const list = !q ? db.suppliers : db.suppliers.filter(s => (s.name || '').toLowerCase().includes(q));
    return list.slice(0, 200);
  },
  renderLabel: (s) => formatSupplierOptionLabel(s),
  renderSubLabel: (s) => s.phone || ''
});

setupSearchableSelect({
  searchInputId: 'guarantor-client-search',
  hiddenInputId: 'guarantor-client-picked-id',
  resultsId: 'guarantor-client-results',
  getItems: (query) => {
    const q = query.toLowerCase();
    const currentClientId = document.getElementById('client-edit-id') ? document.getElementById('client-edit-id').value : '';
    // بنستبعد العميل نفسه من نتائج البحث لو بيعدّل بياناته، عشان محدش يقدر
    // يختار نفسه كضامن لنفسه بالغلط.
    const pool = db.clients.filter(c => c.id !== currentClientId);
    const list = !q ? pool : pool.filter(c =>
      (c.name || '').toLowerCase().includes(q) || (c.nationalId || '').includes(q) || (c.phone || '').includes(q)
    );
    return list.slice(0, 200);
  },
  renderLabel: (c) => c.name,
  renderSubLabel: (c) => `الهوية: ${c.nationalId} — هاتف: ${c.phone}`,
  onChange: (c) => {
    // FEATURE: نسخ بيانات بس - مفيش أي ربط دائم بين الضامن والعميل المختار.
    // لو غيّرت بيانات العميل ده بعدين، الضامن هنا مش هيتأثر خالص (نسخة مستقلة).
    document.getElementById('guarantor-fullname').value = c.name;
    document.getElementById('guarantor-national-id').value = c.nationalId || '';
    document.getElementById('guarantor-phone').value = c.phone || '';

    const warningEl = document.getElementById('guarantor-client-risk-warning');
    const risk = getClientRiskInfo(c.id);
    if (!risk || risk.level === 'none') {
      warningEl.classList.add('hidden');
    } else {
      const colors = {
        high: 'bg-rose-50 text-rose-700 border border-rose-200',
        medium: 'bg-amber-50 text-amber-700 border border-amber-200'
      };
      warningEl.className = `mt-2 p-2 rounded-lg text-xs font-semibold ${colors[risk.level]}`;
      warningEl.textContent = `⚠️ الشخص ده عميل عندك برضه وله سجل كعميل: ${risk.label}`;
      warningEl.classList.remove('hidden');
    }
  }
});

setupSearchableSelect({
  searchInputId: 'request-client-search',
  hiddenInputId: 'request-client-picked-id',
  resultsId: 'request-client-results',
  getItems: (query) => {
    const q = query.toLowerCase();
    const list = !q ? db.clients : db.clients.filter(c =>
      (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q)
    );
    return list.slice(0, 200);
  },
  renderLabel: (c) => c.name,
  renderSubLabel: (c) => `هاتف: ${c.phone}`,
  onChange: (c) => {
    document.getElementById('request-client-name').value = c.name;
    document.getElementById('request-client-phone').value = c.phone || '';
  }
});

function populateDropdowns() {
  try {
    // تحديث قائمة التصنيفات في إضافة جهاز
    const devCatSelect = document.getElementById('device-category-select');
    if (devCatSelect) {
      const prev = devCatSelect.value;
      devCatSelect.innerHTML = '<option value="">اختر الصنف...</option>';
      db.productCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        devCatSelect.appendChild(opt);
      });
      if (prev) devCatSelect.value = prev;
    }

    const brandCatSelect = document.getElementById('brand-category-select');
    if (brandCatSelect) {
      brandCatSelect.innerHTML = '<option value="">اختر التصنيف...</option>';
      db.productCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        brandCatSelect.appendChild(opt);
      });
    }

    // ملحوظة: كان هنا كود بيملأ contract-client-select و contract-device-select
    // كـ <select> عادي بكل العملاء/الأجهزة. اتشال لأنهم بقوا "بحث قابل
    // للاختيار" (searchable picker) بيقرا من db.clients/db.inventory مباشرة
    // وقت الكتابة بدل ما نبني قائمة ثابتة مسبقًا (راجع setupSearchableSelect
    // و initContractPickers).

    // ملحوظة: قائمة "device-brand-select" (الماركة) و"device-model-select" (الموديل)
    // بتتحدث بشكل هرمي صحيح عن طريق updateBrandList() و updateDeviceModelList()
    // (بتتنفذ تلقائياً عند اختيار الصنف ثم الماركة في نموذج "إضافة جهاز للمخزن").
    // كان هنا قبل كده كود قديم بيمسح القائمة ويملأها بكل db.brands كنصوص خام
    // بشكل مسطح (من غير فلترة بالصنف)، وده كان بيكسر القائمة فعلياً ويطلع
    // "[object Object]" لأن db.brands بقت تخزن كائنات {id, name, categoryId}
    // مش نصوص. تم حذفه نهائياً؛ لو فيه صنف محدد بالفعل وقت استدعاء الدالة دي،
    // بنعيد تحديث قائمة الماركات بتاعته صح.
    const activeDeviceCategory = document.getElementById('device-category-select');
    if (activeDeviceCategory && activeDeviceCategory.value && typeof updateBrandList === 'function') {
      updateBrandList();
    }

    // تهيئة فلاتر المصروفات لو مش مهيئة
    const expFilterMonth = document.getElementById('expense-filter-month');
    if (expFilterMonth && !expFilterMonth.value) {
      expFilterMonth.value = new Date().toISOString().substring(0, 7);
    }
    const expInputDate = document.getElementById('expense-date');
    if (expInputDate && !expInputDate.value) {
      expInputDate.value = new Date().toISOString().split('T')[0];
    }

    const supplierSelect = document.getElementById('device-supplier');
    if (supplierSelect) {
      const prevVal = supplierSelect.value;
      supplierSelect.innerHTML = '';
      if (db.suppliers.length === 0) {
        supplierSelect.innerHTML = '<option value="">لا يوجد موردين مسجلين - أضف مورد أولاً</option>';
      }
      db.suppliers.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = formatSupplierOptionLabel(s);
        supplierSelect.appendChild(opt);
      });
      if ([...supplierSelect.options].some(o => o.value === prevVal)) supplierSelect.value = prevVal;
    }

    // FIX: نفس تعبئة قائمة الموردين لخانة "استيراد دفعة كبيرة" الجديدة.
    const importSupplierSelect = document.getElementById('import-inventory-supplier');
    if (importSupplierSelect) {
      const prevVal = importSupplierSelect.value;
      importSupplierSelect.innerHTML = '';
      if (db.suppliers.length === 0) {
        importSupplierSelect.innerHTML = '<option value="">لا يوجد موردين مسجلين - أضف مورد أولاً</option>';
      }
      db.suppliers.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = formatSupplierOptionLabel(s);
        importSupplierSelect.appendChild(opt);
      });
      if ([...importSupplierSelect.options].some(o => o.value === prevVal)) importSupplierSelect.value = prevVal;
    }

    // قائمة الأصناف داخل نموذج إضافة/تعديل منتج
    const productCategorySelect = document.getElementById('product-category-select');
    if (productCategorySelect) {
      const prevVal = productCategorySelect.value;
      productCategorySelect.innerHTML = '<option value="">اختر الصنف...</option>';
      db.productCategories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        productCategorySelect.appendChild(opt);
      });
      if ([...productCategorySelect.options].some(o => o.value === prevVal)) productCategorySelect.value = prevVal;
    }

    // قائمة المورد الافتراضي الخاصة بنموذج المنتج (لسه <select> عادي)
    [
      { id: 'product-default-supplier', placeholder: 'بدون مورد افتراضي' }
    ].forEach(({ id: selectId, placeholder }) => {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      const prevVal = sel.value;
      sel.innerHTML = `<option value="">${placeholder}</option>`;
      db.suppliers.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = formatSupplierOptionLabel(s);
        sel.appendChild(opt);
      });
      if ([...sel.options].some(o => o.value === prevVal)) sel.value = prevVal;
    });

    const collectorSelect = document.getElementById('contract-collector-select');
    if (collectorSelect) {
      collectorSelect.innerHTML = '<option value="">اختر المحصل المسئول...</option>';
      db.users.filter(u => u.role === 'COLLECTOR').forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.name;
        opt.textContent = `${u.name} (${u.area})`;
        collectorSelect.appendChild(opt);
      });
    }

    const collectionMonthSelect = document.getElementById('collection-filter-month');
    if (collectionMonthSelect) {
      collectionMonthSelect.innerHTML = '<option value="all">كل الأشهر</option>';
      const months = [...new Set(db.installments.map(i => i.dueDate.substring(0, 7)))].sort();
      months.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        collectionMonthSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error populating dropdowns:', err);
  }
}

// IMPROVEMENT #1 (الأداء): بدل ما نستدعي دوال الرسم على كل ضغطة حرف مباشرة
// (وده كان بيسبب بطء محسوس في البحث خصوصاً مع قوائم كبيرة)، بنلف كل مستمع
// بحث بدالة debounce بمهلة 300ms، وبنرجّع رقم صفحة القائمة لأول صفحة مع كل
// بحث جديد عشان المستخدم ميفضلش واقف في صفحة فاضية.
function debouncedSearch(paginationKey, renderFn) {
  return debounce(() => { if (paginationKey) resetPage(paginationKey); renderFn(); }, 300);
}

document.getElementById('client-search-input').addEventListener('input', debouncedSearch('clients', renderClients));
document.getElementById('inventory-search').addEventListener('input', debouncedSearch(null, renderInventory));
['inventory-filter-status', 'inventory-filter-branch', 'inventory-filter-supplier'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', renderInventory);
});
const lowStockFilterEl = document.getElementById('inventory-filter-lowstock');
if (lowStockFilterEl) lowStockFilterEl.addEventListener('change', renderInventory);
document.getElementById('contract-search-input').addEventListener('input', debouncedSearch('contracts', renderContracts));
document.getElementById('collection-search-input').addEventListener('input', debouncedSearch(null, renderCollections));
document.getElementById('collection-filter-month').addEventListener('change', renderCollections);
document.getElementById('collection-filter-status').addEventListener('change', renderCollections);


document.getElementById('btn-save-settings').addEventListener('click', () => {
  const offline = document.getElementById('setting-offline-mode').checked;
  const companyName = document.getElementById('setting-company-name').value.trim();
  const logoUrl = document.getElementById('setting-company-logo-url').value;
  const logoFileInput = document.getElementById('setting-company-logo-file');

  db.settings.offlineMode = offline;
  db.settings.withdrawalApprovalThreshold = Math.max(0, parseFloat(document.getElementById('setting-withdrawal-threshold').value) || 0);
  // IMPROVEMENT #6: حفظ مدة تسجيل الخروج التلقائي عند الخمول، ونطبقها فوراً
  // على الجلسة الحالية (بدل ما تتفعل بعد Refresh بس).
  db.settings.sessionTimeoutMinutes = Math.max(0, parseFloat(document.getElementById('setting-session-timeout').value) || 0);
  resetIdleTimer();
  if (companyName) db.settings.companyName = companyName;

  // مهم جداً: لو المستخدم رفع صورة لوجو محلية (ملف)، بيتم تخزين الـ base64 فوراً في
  // db.settings.companyLogo وقت اختيار الملف (شوف حدث change تحت). حقل النص بيبقى
  // فيه وقتها نص وهمي "تم تحميل لوجو محلي كـ Base64" مش الصورة نفسها، فلو خدنا قيمة
  // الحقل النصي وكتبناها فوق companyLogo هنا، هنمسح الصورة الحقيقية ونحط النص الوهمي
  // مكانها بالغلط (وده اللي كان بيحصل ويبوظ اللوجو). فبنتأكد إننا منلمسش القيمة إلا
  // لو المستخدم فعلاً كاتب رابط URL حقيقي أو ماسح الحقل، مش رافع ملف محلي.
  const isPlaceholderText = logoUrl === 'تم تحميل لوجو محلي كـ Base64';
  const hasLocalFileSelected = logoFileInput && logoFileInput.files && logoFileInput.files.length > 0;
  if (!isPlaceholderText && !hasLocalFileSelected) {
    db.settings.companyLogo = logoUrl;
  }

  if (!db.settings.templates) db.settings.templates = {};
  db.settings.templates.reminder = document.getElementById('template-reminder').value;
  db.settings.templates.warning = document.getElementById('template-warning').value;
  db.settings.templates.receipt = document.getElementById('template-receipt').value;

  // حفظ صلاحيات دور STAFF الدقيقة (لو الخانات موجودة في الصفحة، يعني المستخدم أدمن)
  if (!db.settings.staffPermissions) db.settings.staffPermissions = getDefaultStaffPermissions();
  STAFF_PERMISSION_TABS.forEach(tabKey => {
    const checkbox = document.getElementById(`perm-${tabKey}`);
    if (checkbox) db.settings.staffPermissions[tabKey] = checkbox.checked;
  });

  // IMPROVEMENT #3: حفظ صلاحيات دور COLLECTOR الدقيقة
  if (!db.settings.collectorPermissions) db.settings.collectorPermissions = getDefaultCollectorPermissions();
  COLLECTOR_PERMISSION_TABS.forEach(tabKey => {
    const checkbox = document.getElementById(`cperm-${tabKey}`);
    if (checkbox) db.settings.collectorPermissions[tabKey] = checkbox.checked;
  });

  applyCompanyBranding();
  updateSyncStatusUI();
  updateUIForRole();
  logAction('تعديل إعدادات', `تحديث إعدادات النظام واسم الشركة والتوريد السحابي وصلاحيات الموظفين والمحصلين`);
  alert('تم حفظ إعدادات النظام وهوية الشركة بنجاح!');
  
  syncWithAppsScript('updateSettings', {
    id: 'global',
    companyName: db.settings.companyName,
    companyLogo: db.settings.companyLogo,
    offlineMode: db.settings.offlineMode,
    templates: db.settings.templates,
    staffPermissions: db.settings.staffPermissions,
    collectorPermissions: db.settings.collectorPermissions,
    sessionTimeoutMinutes: db.settings.sessionTimeoutMinutes
  });

  if (!offline) {
    loadFromServer();
  }
});

// ================= ⚠️ التعديل الجوهري والنهائي للفحص الذكي =================
// Test connection button removed for Firebase integration.

document.getElementById('btn-seed-data').addEventListener('click', async () => {
  if (await customConfirm('هل ترغب في إعادة تهيئة النظام؟ سيؤدي هذا لمسح جميع البيانات الحالية (يوزرات، عملاء، عقود، مخزون...) وإرجاع النظام لحالة فارغة تماماً. هذا الإجراء لا يمكن التراجع عنه.')) {
    db = defaultSeedData;
    generateSeededInstallments();
    logAction('حقن بيانات', 'إعادة تهيئة النظام وحقن البيانات النموذجية للتجربة');
    alert('تم إعادة تهيئة قاعدة البيانات بنجاح!');
    location.reload();
  }
});

document.getElementById('btn-clear-db').addEventListener('click', async () => {
  if (await customConfirm('⚠️ هل أنت متأكد من مسح جميع البيانات التشغيلية نهائياً من قاعدة البيانات السحابية (عملاء، عقود، مخزون، خزينة، مصروفات، موردين)؟\n\nملاحظة: سيتم الحفاظ الكامل على حسابات المستخدمين وإعدادات الشركة وسجل العمليات (Audit Log)، ولن يتأثروا إطلاقاً.\n\nهذا الإجراء نهائي ولا يمكن التراجع عنه.')) {
    const btn = document.getElementById('btn-clear-db');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> جاري المسح من السحابة...';

    // قائمة الجداول التشغيلية المسموح مسحها فعلياً من Firestore.
    // ملحوظة أمان: users / userRoles / settings مستبعدين عمداً داخل
    // FirebaseService.clearOperationalData نفسها كمان (طبقة حماية مزدوجة).
    // FIX: كان "auditLogs" (سجل العمليات) مُدرَج ضمن اللي بيتمسح، لكن قواعد
    // الحماية في Firestore بتمنع حذفه نهائياً وعمداً (allow delete: if false)
    // حفاظاً على مصداقيته كسجل تاريخي غير قابل للتلاعب. النتيجة كانت إن
    // العملية كانت توقف بخطأ "صلاحيات غير كافية" لما توصل له بالترتيب - لكن
    // بعد ما تكون فعلاً مسحت بنجاح كل الأنواع اللي قبله (عملاء، مخزون، عقود،
    // أقساط، موردين، خزينة، مصروفات...) من قاعدة البيانات الحقيقية! والرسالة
    // اللي كانت بتظهر ("لم يتم مسح أي بيانات") كانت غلط تماماً وممكن تكون
    // خدعت حد إنه يفتكر بياناته لسه موجودة وهي أصلاً اتمسحت جزئياً بالفعل.
    const operationalCollections = ['clients', 'inventory', 'contracts', 'installments', 'brands', 'suppliers', 'supplierTransactions', 'collectorCustodies', 'treasuryTransactions', 'expenses', 'productCategories', 'products', 'productStockMovements'];

    let cloudResult = { success: true };
    if (window.FirebaseService && window.FirebaseService.isAvailable()) {
      cloudResult = await window.FirebaseService.clearOperationalData(operationalCollections);
    }

    if (!cloudResult.success) {
      btn.disabled = false;
      btn.innerHTML = originalText;
      // FIX: كانت الرسالة هنا بتقول دايماً "لم يتم مسح أي بيانات" بغض النظر
      // عن حقيقة الموقف - وده كان غلط تماماً في حالة auditLogs (كان جزء كبير
      // من البيانات بيتمسح فعلاً قبل الوصول لنقطة الفشل). دلوقتي الرسالة
      // بتوضح بدقة أي مجموعات بيانات اتمسحت فعلاً وأيها لأ.
      const succeededList = cloudResult.succeeded || [];
      const partialNote = succeededList.length > 0
        ? `\n\n⚠️ تنبيه هام: ${succeededList.length} من أنواع البيانات اتمسحت فعلاً ونهائياً من قاعدة البيانات قبل حدوث هذا الخطأ (${succeededList.join(', ')}). دي مش قابلة للاسترجاع.`
        : '\n\nلم يتم مسح أي بيانات فعلياً - العملية توقفت قبل أي حذف.';
      alert('❌ حدث خطأ أثناء المسح من السحابة: ' + (cloudResult.error || 'خطأ غير معروف') + partialNote);
      // نحدّث البيانات المحلية من قاعدة البيانات فوراً عشان تعكس أي مسح
      // جزئي حصل فعلاً، بدل ما تفضل الشاشة عارضة بيانات قديمة اتمسحت أصلاً.
      if (!db.settings.offlineMode) loadFromServer();
      return;
    }

    // بعد التأكد من نجاح المسح الفعلي في Firestore، نصفّر النسخة المحلية كمان
    db.clients = [];
    db.inventory = [];
    db.contracts = [];
    db.installments = [];
    db.brands = [];
    db.suppliers = [];
    db.supplierTransactions = [];
    db.collectorCustodies = [];
    db.treasuryTransactions = [];
    db.expenses = [];
    db.productCategories = [];
    db.products = [];
    db.productStockMovements = [];

    // الحفاظ على db.users و db.settings و db.auditLogs (سجل العمليات لا
    // يُمسح أبداً - لا محلياً ولا من قاعدة البيانات - حفاظاً على مصداقيته)

    alert('✅ تم مسح البيانات التشغيلية نهائياً من قاعدة البيانات السحابية (Firebase) مع الحفاظ الكامل على المستخدمين والإعدادات وسجل العمليات.\n\nيمكنك الآن البدء بإدخال بيانات جديدة نظيفة.');
    location.reload();
  }
});

// ================= ترحيل أمني: نقل المستخدمين القدام (كلمة مرور نصية) إلى Firebase Authentication =================
// أي مستخدم قديم كان مُخزَّناً بكلمة مرور نصية في Firestore (قبل تفعيل Firebase
// Authentication الحقيقي) لازم يتم ترحيله مرة واحدة: يتم إنشاء حساب حقيقي له
// في Firebase Authentication بنفس كلمة المرور القديمة، ثم تُحذف كلمة المرور
// النصية نهائياً من قاعدة البيانات (Firestore) ولا تعود تُخزَّن هناك إطلاقاً.
window.migrateUsersToFirebaseAuth = async function() {
  await runWithActionLock("migrate-users", async () => {
  if (!isAdmin()) {
    alert('⛔ هذه العملية مخصصة للمشرف (ADMIN) فقط.');
    return;
  }
  if (!window.FirebaseAuthService) {
    alert('❌ تعذر الاتصال بخدمة Firebase Authentication. تأكد من اتصال الإنترنت.');
    return;
  }

  const legacyUsers = db.users.filter(u => u.password && !u.authUid);
  if (legacyUsers.length === 0) {
    alert('✅ لا يوجد أي مستخدمين بحاجة للترحيل. كل الحسابات آمنة بالفعل عبر Firebase Authentication.');
    return;
  }

  const confirmMsg = `سيتم إنشاء حسابات Firebase Authentication آمنة لعدد ${legacyUsers.length} مستخدم (${legacyUsers.map(u => u.username).join('، ')})، ثم حذف كلمات المرور النصية القديمة الخاصة بهم نهائياً من قاعدة البيانات.\n\nهام: كل مستخدم سيستمر بتسجيل الدخول بنفس اسم المستخدم وكلمة المرور الحاليين تماماً، فقط طريقة التحقق ستصبح آمنة عبر Firebase.\n\nهل تريد المتابعة؟`;
  if (!(await customConfirm(confirmMsg))) return;

  let successCount = 0;
  const failedUsers = [];

  for (const u of legacyUsers) {
    try {
      const result = await window.FirebaseAuthService.createAuthUser(u.username, u.password);
      if (result.success) {
        // تحديث محلي: إضافة authUid وحذف كلمة المرور النصية من الذاكرة
        u.authUid = result.uid;
        delete u.password;

        // FIX: ننشئ userRoles أولاً عشان تنجح عملية updateUser بعدين
        if (window.FirebaseAuthService.ensureUserRoleDoc) {
          await window.FirebaseAuthService.ensureUserRoleDoc(result.uid, u.role, u.name);
        }
        // تحديث Firestore: إضافة authUid، وحذف حقل password نهائياً بواسطة FieldValue.delete()
        // وبعت الدور "role" كمان عشان يتزامن مستند userRoles اللي قواعد الأمان بتعتمد عليه
        await syncWithAppsScript('updateUser', {
          id: u.id,
          authUid: result.uid,
          role: u.role,
          password: firebase.firestore.FieldValue.delete()
        });
        successCount++;
      }
    } catch (err) {
      console.error('Migration failed for user', u.username, err);
      failedUsers.push(`${u.username} (${err.code || err.message})`);
    }
  }

  renderUsers();
  logAction('ترحيل أمني', `تم ترحيل ${successCount} من ${legacyUsers.length} مستخدم إلى Firebase Authentication الآمن`);

  let resultMsg = `✅ تم ترحيل ${successCount} من ${legacyUsers.length} مستخدم بنجاح إلى Firebase Authentication.`;
  if (failedUsers.length > 0) {
    resultMsg += `\n\n⚠️ فشل ترحيل الحسابات التالية (غالباً لأن الحساب موجود مسبقاً في Firebase Authentication):\n${failedUsers.join('\n')}`;
  }
  alert(resultMsg);
  });
};

document.getElementById('btn-export-json').addEventListener('click', () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `sky_erp_backup_${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
});

window.exportTransactionsCSV = function() {
  let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
  csvContent += "التاريخ والوقت,النوع التقييدي,البيان والشرح بالتفصيل,المبلغ الفعلي المورد بالخزينة\n";
  
  db.treasuryTransactions.forEach(tx => {
    let typeText = tx.type;
    let amountStr = tx.amount;
    csvContent += `"${tx.timestamp}","${typeText}","${tx.notes.replace(/"/g, '""')}","${amountStr}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `sky_treasury_report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
};

// ================= CLIENT DETAILS VIEWER =================
// ================= متابعة العميل (Follow-up Notes) =================
// سجل ملاحظات بسيط لكل عميل: تاريخ، الموظف/المحصل اللي كتبها، نص الملاحظة،
// وتاريخ متابعة قادم اختياري. الهدف تسهيل المتابعة اليومية (خصوصاً للمحصلين)
// من غير ما حد ينسى آخر مكالمة قال فيها إيه.
window.openClientFollowUpModal = function(clientId) {
  const client = db.clients.find(c => c.id === clientId);
  if (!client) return;
  document.getElementById('followup-client-id').value = clientId;
  document.getElementById('followup-client-name').textContent = client.name;
  document.getElementById('followup-new-note').value = '';
  document.getElementById('followup-next-date').value = '';
  document.getElementById('followup-delay-reason').value = '';
  renderClientFollowUpsList(clientId);
  openModal('client-followup-modal');
};

// ================= متابعة التحصيل (Collection Follow-ups smart view) =================
// عرض ذكي لنفس بيانات "سجل متابعة العميل" الموجودة أصلاً، فلترة على بس
// الملاحظات اللي فيها سبب تأخير مسجّل - مفيش تكرار في تخزين البيانات،
// بس شاشة مخصصة تجمّعهم في مكان واحد لمتابعة حالات التأخير بسهولة.
function renderCollectionFollowUps() {
  const listEl = document.getElementById('collection-followups-list');
  const emptyEl = document.getElementById('collection-followups-empty');
  if (!listEl) return;

  const delayNotes = db.clientFollowUps.filter(n => n.delayReason);

  // تحديث قائمة المحصلين (كتّاب الملاحظات) في الفلتر
  const collectorSelect = document.getElementById('cf-filter-collector');
  if (collectorSelect && collectorSelect.dataset.populated !== 'true') {
    const uniqueCollectors = [...new Set(delayNotes.map(n => n.createdBy))];
    uniqueCollectors.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      collectorSelect.appendChild(opt);
    });
    collectorSelect.dataset.populated = 'true';
  }

  // البونص: أكتر أسباب التأخير تكرارًا
  const breakdownPanel = document.getElementById('delay-reason-breakdown');
  const breakdownList = document.getElementById('delay-reason-breakdown-list');
  if (delayNotes.length > 0) {
    const counts = {};
    delayNotes.forEach(n => { counts[n.delayReason] = (counts[n.delayReason] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    breakdownList.innerHTML = sorted.map(([reason, count]) => `
      <span class="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-full text-xs font-semibold flex items-center gap-1.5">
        ${escapeHTML(reason)}
        <span class="bg-rose-600 text-white rounded-full px-1.5 text-[10px] font-black">${count}</span>
      </span>
    `).join('');
    breakdownPanel.classList.remove('hidden');
  } else {
    breakdownPanel.classList.add('hidden');
  }

  const searchVal = (document.getElementById('cf-search-input').value || '').toLowerCase();
  const reasonFilter = document.getElementById('cf-filter-reason').value;
  const collectorFilter = document.getElementById('cf-filter-collector').value;

  const filtered = delayNotes.filter(n => {
    const matchesSearch = (n.clientName || '').toLowerCase().includes(searchVal);
    const matchesReason = reasonFilter === 'all' ? true : n.delayReason === reasonFilter;
    const matchesCollector = collectorFilter === 'all' ? true : n.createdBy === collectorFilter;
    return matchesSearch && matchesReason && matchesCollector;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = filtered.map(n => `
    <div class="bg-white rounded-xl border border-slate-100 shadow-sm p-3 flex items-start justify-between gap-3">
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-bold text-slate-800 text-sm">${escapeHTML(n.clientName)}</span>
          <span class="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-[10px] font-bold">⏱️ ${escapeHTML(n.delayReason)}</span>
        </div>
        <p class="text-sm text-slate-600">${escapeHTML(n.note)}</p>
        ${n.nextFollowUpDate ? `<p class="text-xs font-semibold text-amber-600 mt-1"><i class="ph ph-calendar-check"></i> متابعة قادمة يوم: ${escapeHTML(n.nextFollowUpDate)}</p>` : ''}
        <p class="text-[11px] text-slate-400 mt-1">${escapeHTML(n.createdBy)} — ${escapeHTML(n.timestamp)}</p>
      </div>
      <button onclick="openClientFollowUpModal('${n.clientId}')" class="shrink-0 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-semibold">فتح ملف العميل</button>
    </div>
  `).join('');
}

function renderClientFollowUpsList(clientId) {
  const listEl = document.getElementById('followup-notes-list');
  const emptyEl = document.getElementById('followup-notes-empty');
  const notes = db.clientFollowUps
    .filter(n => n.clientId === clientId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (notes.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = notes.map(n => `
    <div class="p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-bold text-slate-600">${escapeHTML(n.createdBy)}</span>
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-slate-400 font-mono">${escapeHTML(n.timestamp)}</span>
          ${isAdmin() ? `<button onclick="deleteClientFollowUp('${n.id}', '${clientId}')" class="text-rose-400 hover:text-rose-600"><i class="ph ph-trash text-xs"></i></button>` : ''}
        </div>
      </div>
      ${n.delayReason ? `<span class="inline-block mb-1.5 px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-[10px] font-bold">⏱️ ${escapeHTML(n.delayReason)}</span>` : ''}
      <p class="text-sm text-slate-700 whitespace-pre-wrap">${escapeHTML(n.note)}</p>
      ${n.nextFollowUpDate ? `<p class="text-xs font-semibold text-amber-600 mt-1.5"><i class="ph ph-calendar-check"></i> متابعة قادمة يوم: ${escapeHTML(n.nextFollowUpDate)}</p>` : ''}
    </div>
  `).join('');
}

window.addClientFollowUp = async function() {
  await runWithActionLock('add-followup', async () => {
  const clientId = document.getElementById('followup-client-id').value;
  const client = db.clients.find(c => c.id === clientId);
  if (!client) return;

  const note = document.getElementById('followup-new-note').value.trim();
  if (!note) {
    alert('من فضلك اكتب نص الملاحظة أولاً.');
    return;
  }
  const nextFollowUpDate = document.getElementById('followup-next-date').value || '';
  const delayReason = document.getElementById('followup-delay-reason').value || '';

  const entry = {
    id: `fu-${Date.now()}`,
    clientId: clientId,
    clientName: client.name,
    note: note,
    delayReason: delayReason,
    nextFollowUpDate: nextFollowUpDate,
    createdBy: currentUser ? currentUser.name : 'مجهول',
    timestamp: nowTimestamp()
  };
  db.clientFollowUps.unshift(entry);
  await syncWithAppsScript('addClientFollowUp', entry);

  document.getElementById('followup-new-note').value = '';
  document.getElementById('followup-next-date').value = '';
  document.getElementById('followup-delay-reason').value = '';
  renderClientFollowUpsList(clientId);
  if (typeof renderCollectionFollowUps === 'function') renderCollectionFollowUps();
  showToast('✅ تم حفظ ملاحظة المتابعة', 'success');
  });
};

window.deleteClientFollowUp = async function(id, clientId) {
  if (!isAdmin()) {
    alert('⛔ حذف ملاحظات المتابعة مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  if (!(await customConfirm('هل أنت متأكد من حذف ملاحظة المتابعة دي؟'))) return;
  db.clientFollowUps = db.clientFollowUps.filter(n => n.id !== id);
  await syncWithAppsScript('deleteClientFollowUp', { id });
  renderClientFollowUpsList(clientId);
};

// ================= طلبات العملاء (Customer Requests) =================
// تسجيل طلبات لمنتجات مش متوفرة حاليًا، عشان ما تنساش تدوّر عليها/تتابعها.
window.openAddCustomerRequestModal = function() {
  document.getElementById('request-client-search').value = '';
  document.getElementById('request-client-picked-id').value = '';
  document.getElementById('request-client-results').classList.add('hidden');
  document.getElementById('request-client-name').value = '';
  document.getElementById('request-client-phone').value = '';
  document.getElementById('request-product-description').value = '';
  document.getElementById('request-notes').value = '';
  openModal('customer-request-modal');
};

window.saveCustomerRequest = async function() {
  await runWithActionLock('save-customer-request', async () => {
  const clientName = document.getElementById('request-client-name').value.trim();
  const productDescription = document.getElementById('request-product-description').value.trim();
  if (!clientName || !productDescription) {
    alert('من فضلك اكتب اسم الطالب والمنتج المطلوب على الأقل.');
    return;
  }

  const entry = {
    id: `req-${Date.now()}`,
    clientId: document.getElementById('request-client-picked-id').value || '',
    clientName: clientName,
    clientPhone: document.getElementById('request-client-phone').value.trim(),
    productDescription: productDescription,
    notes: document.getElementById('request-notes').value.trim(),
    status: 'pending',
    createdBy: currentUser ? currentUser.name : 'مجهول',
    timestamp: nowTimestamp()
  };
  db.customerRequests.unshift(entry);
  await syncWithAppsScript('addCustomerRequest', entry);

  logAction('تسجيل طلب عميل', `طلب جديد من ${clientName}: ${productDescription}`);
  closeModal('customer-request-modal');
  renderCustomerRequests();
  updateNotificationBell();
  showToast('✅ تم تسجيل الطلب بنجاح', 'success');
  });
};

const REQUEST_STATUS_LABELS = {
  pending: { label: 'لسه بيتم البحث', badge: 'bg-amber-100 text-amber-700' },
  found: { label: 'تم إيجاده', badge: 'bg-sky-100 text-sky-700' },
  fulfilled: { label: 'تم التحويل لبيع', badge: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'اعتذر العميل', badge: 'bg-slate-200 text-slate-600' }
};

// FEATURE: تحليل بسيط لأكتر المنتجات المطلوبة من "طلبات العملاء" - بيحوّل
// بيانات كنا بس بنسجلها لإشارة شراء فعلية. بيتجاهل الطلبات اللي "اعتذر
// العميل" فيها لأنها مش مؤشر طلب حقيقي مستمر.
function renderMostRequestedDevices() {
  const panel = document.getElementById('most-requested-devices-panel');
  const listEl = document.getElementById('most-requested-devices-list');
  if (!panel || !listEl) return;

  const counts = {};
  db.customerRequests.filter(r => r.status !== 'cancelled').forEach(r => {
    const key = r.productDescription.trim().toLowerCase();
    if (!counts[key]) counts[key] = { label: r.productDescription.trim(), count: 0 };
    counts[key].count++;
  });

  const sorted = Object.values(counts).filter(c => c.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);

  if (sorted.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  listEl.innerHTML = sorted.map(c => `
    <span class="px-3 py-1.5 bg-teal-50 text-teal-700 rounded-full text-xs font-semibold flex items-center gap-1.5">
      ${escapeHTML(c.label)}
      <span class="bg-teal-600 text-white rounded-full px-1.5 text-[10px] font-black">${c.count}</span>
    </span>
  `).join('');
}

function renderCustomerRequests() {
  const searchEl = document.getElementById('request-search-input');
  const statusEl = document.getElementById('request-filter-status');
  const listEl = document.getElementById('customer-requests-list');
  const emptyEl = document.getElementById('customer-requests-empty');
  if (!listEl) return;
  renderMostRequestedDevices();

  const searchVal = (searchEl ? searchEl.value : '').toLowerCase();
  const statusFilter = statusEl ? statusEl.value : 'all';

  const filtered = db.customerRequests.filter(r => {
    const matchesSearch = (r.clientName || '').toLowerCase().includes(searchVal) || (r.productDescription || '').toLowerCase().includes(searchVal);
    const matchesStatus = statusFilter === 'all' ? true : r.status === statusFilter;
    return matchesSearch && matchesStatus;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = filtered.map(r => {
    const st = REQUEST_STATUS_LABELS[r.status] || REQUEST_STATUS_LABELS.pending;
    return `
    <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-2">
      <div class="flex items-start justify-between">
        <div>
          <p class="font-bold text-slate-800">${escapeHTML(r.clientName)}</p>
          ${r.clientPhone ? `<p class="text-xs text-slate-400 font-mono">${escapeHTML(r.clientPhone)}</p>` : ''}
        </div>
        <span class="badge ${st.badge} text-[10px]">${st.label}</span>
      </div>
      <p class="text-sm text-slate-700 bg-slate-50 rounded-lg p-2">${escapeHTML(r.productDescription)}</p>
      ${r.notes ? `<p class="text-xs text-slate-400">${escapeHTML(r.notes)}</p>` : ''}
      <p class="text-[11px] text-slate-400 font-mono">${escapeHTML(r.timestamp)} — ${escapeHTML(r.createdBy)}</p>
      <div class="flex flex-wrap gap-1.5 pt-1 border-t border-slate-50">
        ${r.status !== 'found' ? `<button onclick="updateCustomerRequestStatus('${r.id}', 'found')" class="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-md text-[11px] font-semibold">تم إيجاده</button>` : ''}
        ${r.status !== 'fulfilled' ? `<button onclick="updateCustomerRequestStatus('${r.id}', 'fulfilled')" class="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md text-[11px] font-semibold">تحويل لبيع</button>` : ''}
        ${r.status !== 'cancelled' ? `<button onclick="updateCustomerRequestStatus('${r.id}', 'cancelled')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md text-[11px] font-semibold">اعتذر العميل</button>` : ''}
        <button onclick="deleteCustomerRequest('${r.id}')" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-md text-[11px] font-semibold mr-auto"><i class="ph ph-trash"></i></button>
      </div>
    </div>
  `;
  }).join('');
}

window.updateCustomerRequestStatus = async function(id, newStatus) {
  const req = db.customerRequests.find(r => r.id === id);
  if (!req) return;
  req.status = newStatus;
  await syncWithAppsScript('updateCustomerRequest', { id, status: newStatus });
  renderCustomerRequests();
  updateNotificationBell();
};

window.deleteCustomerRequest = async function(id) {
  if (currentUser && currentUser.role === 'COLLECTOR') {
    alert('⛔ حذف الطلبات مخصص للمشرف/الموظف فقط.');
    return;
  }
  if (!(await customConfirm('هل أنت متأكد من حذف الطلب ده؟'))) return;
  db.customerRequests = db.customerRequests.filter(r => r.id !== id);
  await syncWithAppsScript('deleteCustomerRequest', { id });
  renderCustomerRequests();
  updateNotificationBell();
};

// ================= المصروفات الشهرية الثابتة (Recurring Expenses) =================
// قوالب لمصروفات بتتكرر كل شهر (إيجار، رواتب...) - بدل ما تتكتب من الصفر كل
// مرة، تتسجل مرة واحدة وبعدين تتفعّل كل شهر بضغطة واحدة.
function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function checkPendingRecurringExpenses() {
  const banner = document.getElementById('recurring-expenses-pending-banner');
  if (!banner) return;
  const thisMonth = currentMonthKey();
  const pending = db.recurringExpenses.filter(r => r.active !== false && r.lastAppliedMonth !== thisMonth);
  if (pending.length === 0) {
    banner.classList.add('hidden');
    return;
  }
  document.getElementById('recurring-expenses-pending-text').textContent = `عندك ${pending.length} مصروف شهري ثابت لسه محتاج تسجيل لشهر ${thisMonth}`;
  banner.classList.remove('hidden');
}

window.openRecurringExpensesModal = function() {
  renderRecurringExpensesList();
  openModal('recurring-expenses-modal');
};

function renderRecurringExpensesList() {
  const listEl = document.getElementById('recurring-expenses-templates-list');
  const emptyEl = document.getElementById('recurring-expenses-templates-empty');
  if (!listEl) return;
  const thisMonth = currentMonthKey();

  if (db.recurringExpenses.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = db.recurringExpenses.map(r => {
    const appliedThisMonth = r.lastAppliedMonth === thisMonth;
    return `
    <div class="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between gap-2">
      <div>
        <p class="font-bold text-sm text-slate-800">${escapeHTML(r.category)}</p>
        <p class="text-xs text-slate-500 font-mono">${safeNum(r.amount).toLocaleString()} ج.م شهريًا</p>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        ${appliedThisMonth
          ? `<span class="badge bg-emerald-100 text-emerald-700 text-[10px]">✅ اتسجل لشهر ${thisMonth}</span>`
          : `<button onclick="applyRecurringExpenseNow('${r.id}')" class="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-[11px] font-semibold">تسجيله دلوقتي</button>`
        }
        <button onclick="deleteRecurringExpenseTemplate('${r.id}')" class="text-rose-400 hover:text-rose-600"><i class="ph ph-trash text-sm"></i></button>
      </div>
    </div>
  `;
  }).join('');
}

window.addRecurringExpenseTemplate = async function() {
  await runWithActionLock('add-recurring-template', async () => {
  const category = document.getElementById('recurring-expense-category').value.trim();
  const amount = parseFloat(document.getElementById('recurring-expense-amount').value);
  if (!category || isNaN(amount) || amount <= 0) {
    alert('من فضلك اكتب نوع المصروف وقيمة صحيحة أكبر من صفر.');
    return;
  }
  const entry = {
    id: `rexp-${Date.now()}`,
    category,
    amount,
    active: true,
    lastAppliedMonth: '',
    createdBy: currentUser ? currentUser.name : 'مجهول',
    timestamp: nowTimestamp()
  };
  db.recurringExpenses.push(entry);
  await syncWithAppsScript('addRecurringExpense', entry);

  document.getElementById('recurring-expense-category').value = '';
  document.getElementById('recurring-expense-amount').value = '';
  renderRecurringExpensesList();
  checkPendingRecurringExpenses();
  showToast('✅ تم إضافة المصروف الشهري الثابت', 'success');
  });
};

window.deleteRecurringExpenseTemplate = async function(id) {
  if (!isAdmin()) {
    alert('⛔ حذف المصروفات الثابتة مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  if (!(await customConfirm('هل أنت متأكد من حذف هذا المصروف الشهري الثابت؟ (مش هيمسح المصروفات اللي اتسجلت بيه قبل كده)'))) return;
  db.recurringExpenses = db.recurringExpenses.filter(r => r.id !== id);
  await syncWithAppsScript('deleteRecurringExpense', { id });
  renderRecurringExpensesList();
  checkPendingRecurringExpenses();
};

// بتعمل بالظبط نفس حركة "إضافة مصروف" العادية (تسجيل في db.expenses + حركة
// خزينة)، وبعدين تحدّث القالب إنه اتسجل لشهر ده عشان مايتكررش تسجيله غلط.
window.applyRecurringExpenseNow = async function(templateId) {
  await runWithActionLock(`apply-recurring-${templateId}`, async () => {
  const template = db.recurringExpenses.find(r => r.id === templateId);
  if (!template) return;

  const thisMonth = currentMonthKey();
  const today = new Date().toISOString().split('T')[0];

  const newExpense = {
    id: `exp-${Date.now()}`,
    category: template.category,
    amount: template.amount,
    date: today,
    description: `مصروف شهري ثابت (${template.category}) - تسجيل تلقائي لشهر ${thisMonth}`,
    paidBy: currentUser ? currentUser.name : 'مجهول',
    timestamp: nowTimestamp()
  };
  db.expenses.push(newExpense);

  const treasuryAction = {
    id: `tr-${Date.now()}`,
    type: 'expense',
    amount: -template.amount,
    category: 'مصروفات تشغيلية',
    method: 'cash',
    details: `مصروف شهري ثابت: ${template.category} (${thisMonth})`,
    user: currentUser ? currentUser.name : 'مجهول',
    timestamp: nowTimestamp()
  };
  db.treasuryTransactions.push(treasuryAction);

  template.lastAppliedMonth = thisMonth;

  logAction('تسجيل مصروف شهري ثابت', `تسجيل ${template.category} بقيمة ${template.amount} ج.م لشهر ${thisMonth}`);
  await syncWithAppsScript('addExpense', { expense: newExpense, transaction: treasuryAction });
  await syncWithAppsScript('updateRecurringExpense', { id: templateId, lastAppliedMonth: thisMonth });

  renderRecurringExpensesList();
  checkPendingRecurringExpenses();
  renderExpenses();
  renderTreasury();
  renderDashboard();
  showToast(`✅ تم تسجيل مصروف ${template.category} لشهر ${thisMonth}`, 'success');
  });
};

// ================= استيراد عملاء بالجملة من إكسيل (Bulk Client Import) =================
let parsedImportClients = [];

function findColumnValue(row, possibleKeys) {
  const rowKeys = Object.keys(row);
  for (const wanted of possibleKeys) {
    const match = rowKeys.find(k => k.trim().includes(wanted));
    if (match && row[match] !== undefined && row[match] !== null) return String(row[match]).trim();
  }
  return '';
}

window.handleClientImportFile = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName]);

      if (rows.length === 0) {
        alert('⚠️ الملف فاضي أو مش قادر أقرا صفوف منه.');
        return;
      }

      // FEATURE: مطابقة مرنة لأسماء الأعمدة العربية الشائعة، بدل ما نفرض
      // شكل واحد بالظبط لأسماء الأعمدة في ملف الإكسل.
      parsedImportClients = rows.map(row => {
        const name = findColumnValue(row, ['اسم', 'name', 'Name']);
        const nationalId = findColumnValue(row, ['قومي', 'nationalId', 'National']);
        const phone = findColumnValue(row, ['هاتف', 'موبايل', 'phone', 'Phone']);
        const address = findColumnValue(row, ['عنوان', 'address', 'Address']);

        let status = 'جاهز للاستيراد';
        let isDuplicate = false;
        if (!name) {
          status = '❌ بدون اسم - هيتجاهل';
        } else if (nationalId && db.clients.some(c => c.nationalId === nationalId)) {
          status = '⚠️ رقم قومي مكرر - هيتجاهل';
          isDuplicate = true;
        } else if (phone && db.clients.some(c => c.phone === phone)) {
          status = '⚠️ هاتف مكرر - هيتجاهل';
          isDuplicate = true;
        }

        return { name, nationalId, phone, address, status, skip: !name || isDuplicate };
      });

      renderClientImportPreview();
      openModal('client-import-preview-modal');
    } catch (err) {
      console.error('Error parsing import file:', err);
      alert('❌ تعذر قراءة الملف. تأكد إنه ملف إكسيل أو CSV سليم.');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
};

function renderClientImportPreview() {
  const willImport = parsedImportClients.filter(r => !r.skip);
  const willSkip = parsedImportClients.filter(r => r.skip);

  document.getElementById('client-import-summary').innerHTML = `
    <div class="p-3 bg-slate-50 rounded-xl"><p class="text-lg font-black text-slate-700">${parsedImportClients.length}</p><p class="text-[11px] text-slate-400">إجمالي الصفوف</p></div>
    <div class="p-3 bg-emerald-50 rounded-xl"><p class="text-lg font-black text-emerald-600">${willImport.length}</p><p class="text-[11px] text-slate-400">هيتم استيرادهم</p></div>
    <div class="p-3 bg-amber-50 rounded-xl"><p class="text-lg font-black text-amber-600">${willSkip.length}</p><p class="text-[11px] text-slate-400">هيتم تجاهلهم</p></div>
  `;

  document.getElementById('client-import-preview-body').innerHTML = parsedImportClients.slice(0, 10).map(r => `
    <tr class="border-t border-slate-50">
      <td class="p-2">${escapeHTML(r.name || '—')}</td>
      <td class="p-2 font-mono">${escapeHTML(r.nationalId || '—')}</td>
      <td class="p-2 font-mono">${escapeHTML(r.phone || '—')}</td>
      <td class="p-2 ${r.skip ? 'text-rose-500' : 'text-emerald-600'}">${escapeHTML(r.status)}</td>
    </tr>
  `).join('');

  const confirmBtn = document.getElementById('client-import-confirm-btn');
  if (willImport.length === 0) {
    confirmBtn.disabled = true;
    confirmBtn.classList.add('opacity-50', 'cursor-not-allowed');
  } else {
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

window.confirmClientImport = async function() {
  const confirmBtn = document.getElementById('client-import-confirm-btn');
  if (confirmBtn.disabled) return;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'جاري الاستيراد...';

  try {
    const toImport = parsedImportClients.filter(r => !r.skip).map(r => ({
      id: `cli-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      name: r.name,
      nationalId: r.nationalId,
      phone: r.phone,
      address: r.address,
      locationUrl: '',
      nationalIdImg: '',
      contractImg: '',
      guarantorName: '',
      guarantorNationalId: '',
      guarantorPhone: '',
      guarantorRelation: '',
      guarantorJob: '',
      guarantorAddress: '',
      guarantorCardImg: '',
      guarantorContractImg: ''
    }));

    toImport.forEach(c => db.clients.push(c));

    // FIX: Firestore batch limit 500 عملية - بنقسّم لدفعات آمنة لو الملف كبير
    const CHUNK_SIZE = 400;
    for (let i = 0; i < toImport.length; i += CHUNK_SIZE) {
      const chunk = toImport.slice(i, i + CHUNK_SIZE);
      await syncWithAppsScript('bulkImportClients', { clients: chunk });
    }

    logAction('استيراد عملاء بالجملة', `استيراد ${toImport.length} عميل من ملف إكسيل`);
    closeModal('client-import-preview-modal');
    parsedImportClients = [];
    renderClients();
    populateDropdowns();
    showToast(`✅ تم استيراد ${toImport.length} عميل بنجاح`, 'success');
  } catch (err) {
    console.error('Error importing clients:', err);
    alert('❌ حدث خطأ أثناء الاستيراد. حاول مرة أخرى.');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'تأكيد الاستيراد';
  }
};

// ================= تسوية الخزينة اليومية (Daily Cash Reconciliation) =================
window.openCashReconciliationModal = function() {
  const expected = db.treasuryTransactions.reduce((sum, tx) => sum + safeAmount(tx), 0);
  document.getElementById('reconciliation-expected').textContent = `${expected.toLocaleString()} ج.م`;
  document.getElementById('reconciliation-expected').dataset.value = expected;
  document.getElementById('reconciliation-actual').value = '';
  document.getElementById('reconciliation-notes').value = '';
  document.getElementById('reconciliation-diff-box').classList.add('hidden');
  renderReconciliationHistory();
  openModal('cash-reconciliation-modal');
};

window.updateReconciliationDiff = function() {
  const expected = safeNum(document.getElementById('reconciliation-expected').dataset.value);
  const actual = document.getElementById('reconciliation-actual').value;
  const box = document.getElementById('reconciliation-diff-box');
  if (actual === '') { box.classList.add('hidden'); return; }

  const diff = safeNum(actual) - expected;
  box.classList.remove('hidden');
  if (Math.abs(diff) < 0.01) {
    box.className = 'p-3 rounded-lg text-sm mb-3 font-semibold bg-emerald-50 text-emerald-700';
    box.textContent = '✅ الرصيد مطابق تمامًا، مفيش أي فرق.';
  } else if (diff > 0) {
    box.className = 'p-3 rounded-lg text-sm mb-3 font-semibold bg-sky-50 text-sky-700';
    box.textContent = `ℹ️ في زيادة قدرها ${diff.toLocaleString()} ج.م عن المتوقع.`;
  } else {
    box.className = 'p-3 rounded-lg text-sm mb-3 font-semibold bg-rose-50 text-rose-700';
    box.textContent = `⚠️ في عجز قدره ${Math.abs(diff).toLocaleString()} ج.م عن المتوقع.`;
  }
};

window.saveCashReconciliation = async function() {
  await runWithActionLock('save-cash-reconciliation', async () => {
  const expected = safeNum(document.getElementById('reconciliation-expected').dataset.value);
  const actualRaw = document.getElementById('reconciliation-actual').value;
  if (actualRaw === '' || isNaN(parseFloat(actualRaw))) {
    alert('من فضلك اكتب الرصيد الفعلي بعد الجرد.');
    return;
  }
  const actual = safeNum(actualRaw);
  const difference = actual - expected;
  const notes = document.getElementById('reconciliation-notes').value.trim();

  const entry = {
    id: `recon-${Date.now()}`,
    date: new Date().toISOString().split('T')[0],
    expectedAmount: expected,
    actualAmount: actual,
    difference: difference,
    notes: notes,
    performedBy: currentUser ? currentUser.name : 'مجهول',
    timestamp: nowTimestamp()
  };
  db.cashReconciliations.unshift(entry);
  await syncWithAppsScript('addCashReconciliation', entry);

  logAction('تسوية خزينة يومية', `تسوية بفرق ${difference.toLocaleString()} ج.م (متوقع: ${expected.toLocaleString()}, فعلي: ${actual.toLocaleString()})`);
  renderReconciliationHistory();
  document.getElementById('reconciliation-actual').value = '';
  document.getElementById('reconciliation-notes').value = '';
  document.getElementById('reconciliation-diff-box').classList.add('hidden');
  showToast('✅ تم حفظ التسوية بنجاح', 'success');
  });
};

function renderReconciliationHistory() {
  const listEl = document.getElementById('reconciliation-history-list');
  if (!listEl) return;

  const recent = [...db.cashReconciliations].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
  if (recent.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-slate-400 text-center p-3">مفيش أي تسويات مسجّلة لسه.</p>`;
    return;
  }

  listEl.innerHTML = recent.map(r => {
    const diffOk = Math.abs(r.difference) < 0.01;
    const diffColor = diffOk ? 'text-emerald-600' : (r.difference > 0 ? 'text-sky-600' : 'text-rose-600');
    const diffText = diffOk ? 'مطابق' : `${r.difference > 0 ? '+' : ''}${r.difference.toLocaleString()} ج.م`;
    return `
    <div class="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
      <div class="flex justify-between items-center text-xs">
        <span class="font-semibold text-slate-700">${escapeHTML(r.date)} — ${escapeHTML(r.performedBy)}</span>
        <span class="font-bold ${diffColor}">${diffText}</span>
      </div>
      ${r.notes ? `<p class="text-[11px] text-slate-400 mt-1">${escapeHTML(r.notes)}</p>` : ''}
    </div>
  `;
  }).join('');
}

// ================= القائمة السوداء (Blacklist) =================
window.openBlacklistModal = function() {
  document.getElementById('blacklist-name').value = '';
  document.getElementById('blacklist-national-id').value = '';
  document.getElementById('blacklist-phone').value = '';
  document.getElementById('blacklist-reason').value = '';
  renderBlacklistEntries();
  openModal('blacklist-modal');
};

function renderBlacklistEntries() {
  const listEl = document.getElementById('blacklist-entries-list');
  const emptyEl = document.getElementById('blacklist-entries-empty');
  if (!listEl) return;

  if (db.blacklist.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = [...db.blacklist].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map(b => `
    <div class="p-3 bg-rose-50 rounded-xl border border-rose-100 flex items-start justify-between gap-2">
      <div>
        <p class="font-bold text-sm text-slate-800">${escapeHTML(b.name)}</p>
        <p class="text-xs text-slate-500">${b.nationalId ? `الرقم القومي: ${escapeHTML(b.nationalId)}` : ''} ${b.phone ? `— هاتف: ${escapeHTML(b.phone)}` : ''}</p>
        <p class="text-xs text-rose-600 font-semibold mt-1">${escapeHTML(b.reason || 'بدون سبب مذكور')}</p>
        <p class="text-[10px] text-slate-400 mt-1">أضافه ${escapeHTML(b.addedBy)} — ${escapeHTML(b.timestamp)}</p>
      </div>
      <button onclick="deleteBlacklistEntry('${b.id}')" class="text-rose-400 hover:text-rose-600 shrink-0"><i class="ph ph-trash text-sm"></i></button>
    </div>
  `).join('');
}

window.addBlacklistEntry = async function() {
  await runWithActionLock('add-blacklist-entry', async () => {
  const name = document.getElementById('blacklist-name').value.trim();
  const nationalId = document.getElementById('blacklist-national-id').value.trim();
  const phone = document.getElementById('blacklist-phone').value.trim();
  const reason = document.getElementById('blacklist-reason').value.trim();

  if (!name) {
    alert('من فضلك اكتب اسم الشخص على الأقل.');
    return;
  }
  if (!nationalId && !phone) {
    alert('من فضلك اكتب الرقم القومي أو رقم الهاتف على الأقل، عشان النظام يقدر يتحقق منه لاحقًا.');
    return;
  }

  const entry = {
    id: `bl-${Date.now()}`,
    name, nationalId, phone, reason,
    addedBy: currentUser ? currentUser.name : 'مجهول',
    timestamp: nowTimestamp()
  };
  db.blacklist.push(entry);
  await syncWithAppsScript('addBlacklistEntry', entry);

  logAction('إضافة للقائمة السوداء', `إضافة ${name} للقائمة السوداء - السبب: ${reason || 'غير مذكور'}`);
  document.getElementById('blacklist-name').value = '';
  document.getElementById('blacklist-national-id').value = '';
  document.getElementById('blacklist-phone').value = '';
  document.getElementById('blacklist-reason').value = '';
  renderBlacklistEntries();
  showToast('✅ تم الإضافة للقائمة السوداء', 'success');
  });
};

window.deleteBlacklistEntry = async function(id) {
  if (currentUser && currentUser.role === 'COLLECTOR') {
    alert('⛔ التعديل في القائمة السوداء مخصص للمشرف/الموظف فقط.');
    return;
  }
  await runWithActionLock(`delete-blacklist-${id}`, async () => {
  if (!(await customConfirm('هل أنت متأكد من حذف هذا الشخص من القائمة السوداء؟'))) return;
  db.blacklist = db.blacklist.filter(b => b.id !== id);
  await syncWithAppsScript('deleteBlacklistEntry', { id });
  logAction('حذف من القائمة السوداء', `حذف سجل من القائمة السوداء برقم ${id}`);
  renderBlacklistEntries();
  });
};

window.viewClientDetails = function(clientId) {
  const client = db.clients.find(c => c.id === clientId);
  if (!client) return;

  const clientContracts = db.contracts.filter(c => c.clientId === clientId);
  
  let contractsHtml = clientContracts.map(c => `
    <div class="p-3 bg-slate-50 rounded-lg border border-slate-100 mb-2">
      <div class="flex justify-between font-bold text-xs text-slate-800">
        <span>رقم العقد: ${escapeHTML(c.id.replace('con-', ''))}</span>
        <span class="text-teal-600">${c.totalValue.toLocaleString()} ج.م</span>
      </div>
      <p class="text-[10px] text-slate-500 mt-1">الجهاز: ${escapeHTML(c.deviceInfo)} | المحصل: ${escapeHTML(c.collectorName)}</p>
    </div>
  `).join('');

  if (clientContracts.length === 0) {
    contractsHtml = '<p class="text-xs text-slate-400">لا توجد عقود مسجلة لهذا العميل حالياً.</p>';
  }

  const risk = getClientRiskInfo(clientId);
  const riskHtml = (risk && risk.level !== 'none') ? `
    <div class="p-3 rounded-xl text-sm font-bold ${risk.level === 'high' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
      ${risk.label}
    </div>
  ` : (risk && risk.level === 'none' ? `<div class="p-3 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">${risk.label}</div>` : '');

  const detailDiv = document.createElement('div');
  detailDiv.id = 'client-profile-modal';
  detailDiv.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4';
  
  const docView = (title, data) => {
    if (data && data.startsWith('data:image')) {
      return `<button type="button" onclick="openBase64InPreviewModal('${title}', '${data}')" class="font-bold text-teal-600 hover:text-teal-800 underline block mt-1">عرض المستند 👁️</button>`;
    }
    return `<span class="font-semibold text-slate-400 truncate block mt-1">${data || 'غير متوفر'}</span>`;
  };

  detailDiv.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-2xl shadow-2xl p-6 overflow-hidden max-h-[85vh] flex flex-col">
      <div class="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
        <h4 class="font-bold text-lg text-slate-800 flex items-center gap-2"><i class="ph ph-identification-card text-teal-600"></i> الملف التعريفي للعميل</h4>
        <button onclick="document.getElementById('client-profile-modal').remove()" class="text-slate-400 hover:text-slate-600"><i class="ph ph-x text-lg"></i></button>
      </div>
      <div class="flex-1 overflow-y-auto space-y-6 text-sm">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <h5 class="font-bold text-teal-600 border-b border-teal-50 pb-1 mb-2">بيانات العميل</h5>
            <p class="mb-1"><strong>الاسم الرباعي:</strong> ${escapeHTML(client.name)}</p>
            <p class="mb-1"><strong>الهوية القومية:</strong> ${escapeHTML(client.nationalId)}</p>
            <p class="mb-1"><strong>الهاتف:</strong> ${escapeHTML(client.phone)}</p>
            <p class="mb-1"><strong>العنوان:</strong> ${escapeHTML(client.address)}</p>
            ${client.locationUrl && /^https?:\/\//i.test(client.locationUrl) ? `<a href="${escapeHTML(client.locationUrl)}" target="_blank" class="text-teal-600 hover:underline text-xs font-semibold"><i class="ph ph-map-pin"></i> عرض خرائط Google</a>` : ''}
          </div>
          <div>
            <h5 class="font-bold text-emerald-600 border-b border-emerald-50 pb-1 mb-2">بيانات الضامن</h5>
            <p class="mb-1"><strong>الاسم الرباعي:</strong> ${escapeHTML(client.guarantorName) || '-'}</p>
            <p class="mb-1"><strong>الهوية القومية:</strong> ${escapeHTML(client.guarantorNationalId) || '-'}</p>
            <p class="mb-1"><strong>الهاتف:</strong> ${escapeHTML(client.guarantorPhone) || '-'}</p>
            <p class="mb-1"><strong>صلة القرابة:</strong> ${escapeHTML(client.guarantorRelation) || '-'}</p>
            <p class="mb-1"><strong>العنوان:</strong> ${escapeHTML(client.guarantorAddress) || '-'}</p>
          </div>
        </div>

        <div class="bg-slate-50 p-4 rounded-xl border border-slate-100">
          <h5 class="font-bold text-slate-700 mb-3 text-xs">المستندات والملفات المرفقة:</h5>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
            <div class="bg-white p-2 rounded border border-slate-200">
              <span class="block text-slate-400 text-[10px]">بطاقة العميل</span>
              ${docView('بطاقة العميل', client.nationalIdImg)}
            </div>
            <div class="bg-white p-2 rounded border border-slate-200">
              <span class="block text-slate-400 text-[10px]">عقد العميل</span>
              ${docView('عقد العميل', client.contractImg)}
            </div>
            <div class="bg-white p-2 rounded border border-slate-200">
              <span class="block text-slate-400 text-[10px]">بطاقة الضامن</span>
              ${docView('بطاقة الضامن', client.guarantorCardImg)}
            </div>
            <div class="bg-white p-2 rounded border border-slate-200">
              <span class="block text-slate-400 text-[10px]">عقد الضامن</span>
              ${docView('عقد الضامن', client.guarantorContractImg)}
            </div>
          </div>
        </div>

        ${riskHtml}

        <div>
          <h5 class="font-bold text-slate-700 border-b border-slate-100 pb-1 mb-2">العقود المفتوحة</h5>
          ${contractsHtml}
        </div>

        <div>
          <div class="flex items-center justify-between border-b border-slate-100 pb-1 mb-2">
            <h5 class="font-bold text-amber-700">سجل المتابعة</h5>
            <button onclick="document.getElementById('client-profile-modal').remove(); openClientFollowUpModal('${client.id}');" class="text-[11px] px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-md font-semibold flex items-center gap-1"><i class="ph ph-plus"></i> إضافة متابعة</button>
          </div>
          ${(() => {
            const notes = db.clientFollowUps.filter(n => n.clientId === client.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            if (notes.length === 0) return `<p class="text-xs text-slate-400">لا توجد أي متابعات مسجّلة لهذا العميل بعد.</p>`;
            return notes.slice(0, 5).map(n => `
              <div class="p-2.5 bg-amber-50/50 rounded-lg border border-amber-100 mb-1.5">
                <div class="flex justify-between text-[10px] text-slate-400 mb-1"><span>${escapeHTML(n.createdBy)}</span><span class="font-mono">${escapeHTML(n.timestamp)}</span></div>
                <p class="text-xs text-slate-700">${escapeHTML(n.note)}</p>
              </div>
            `).join('') + (notes.length > 5 ? `<p class="text-[10px] text-slate-400 mt-1">+ ${notes.length - 5} متابعة أقدم — اضغط "إضافة متابعة" لعرض السجل الكامل.</p>` : '');
          })()}
        </div>
      </div>
      <div class="pt-3 border-t border-slate-100 flex justify-end gap-2">
        <button onclick="printClientStatement('${client.id}')" class="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"><i class="ph ph-printer"></i> طباعة كشف حساب شامل</button>
        <button onclick="document.getElementById('client-profile-modal').remove()" class="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">إغلاق</button>
      </div>
    </div>
  `;
  document.body.appendChild(detailDiv);
};

// ================= CLIENT STATEMENT (كشف حساب شامل للعميل) =================
// بيجمع كل عقود العميل وكل أقساطه (مدفوعة ومتبقية) في مستند واحد قابل للطباعة/الحفظ PDF.
window.printClientStatement = function(clientId) {
  const client = db.clients.find(c => c.id === clientId);
  if (!client) return;

  const companyName = db.settings.companyName || 'شركة SKY';
  const clientContracts = db.contracts.filter(c => c.clientId === clientId);

  if (clientContracts.length === 0) {
    showToast('❌ لا توجد عقود مسجلة لهذا العميل لإصدار كشف حساب.', 'error');
    return;
  }

  let grandTotalValue = 0, grandTotalPaid = 0, grandTotalRemaining = 0;

  const contractsBlocks = clientContracts.map(contract => {
    const balance = computeContractBalance(contract);
    grandTotalValue += balance.totalValue;
    grandTotalPaid += balance.totalPaid;
    grandTotalRemaining += balance.totalRemaining;

    const contractInsts = db.installments
      .filter(i => i.contractId === contract.id)
      .sort((a, b) => (a.installmentNum || 0) - (b.installmentNum || 0));

    const instRows = contractInsts.map(inst => {
      const statusInfo = getInstallmentOverdueStatus(inst);
      const isPaid = inst.status === 'paid';
      return `
        <tr>
          <td>قسط ${inst.installmentNum}</td>
          <td>${escapeHTML(inst.dueDate)}</td>
          <td>${inst.amount.toLocaleString()} ج.م</td>
          <td>${isPaid ? `${(inst.paidAmount || inst.amount).toLocaleString()} ج.م` : '—'}</td>
          <td>${isPaid ? escapeHTML(inst.paidDate || '—') : '—'}</td>
          <td>${statusInfo.fine > 0 ? statusInfo.fine.toLocaleString() + ' ج.م' : '—'}</td>
          <td style="font-weight:700;">${isPaid ? 'مسدد' : statusInfo.statusText}</td>
        </tr>
      `;
    }).join('');

    return `
      <div style="margin-top:18px; page-break-inside: avoid;">
        <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; padding:8px 12px; border-radius:6px; margin-bottom:6px;">
          <strong>عقد رقم: ${escapeHTML(contract.id.replace('con-', ''))} — ${escapeHTML(contract.deviceInfo)}</strong>
          <span style="font-size:0.75rem; color:#64748b;">تاريخ العقد: ${escapeHTML(contract.startDate)}</span>
        </div>
        <div class="print-doc-row"><span>قيمة العقد الإجمالية</span><strong>${balance.totalValue.toLocaleString()} ج.م</strong></div>
        <div class="print-doc-row"><span>الدفعة المقدمة</span><strong>${(contract.downPayment || 0).toLocaleString()} ج.م</strong></div>
        <div class="print-doc-row"><span>إجمالي المسدد (شامل المقدم)</span><strong>${balance.totalPaid.toLocaleString()} ج.م</strong></div>
        <div class="print-doc-row"><span>إجمالي المتبقي</span><strong>${balance.totalRemaining.toLocaleString()} ج.م</strong></div>
        <table class="print-doc-table" style="margin-top:8px;">
          <thead>
            <tr><th>القسط</th><th>تاريخ الاستحقاق</th><th>القيمة</th><th>المسدد فعلياً</th><th>تاريخ السداد</th><th>غرامة</th><th>الحالة</th></tr>
          </thead>
          <tbody>${instRows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    <div class="print-doc-title">كشف حساب شامل للعميل</div>

    <div class="print-doc-row"><span>اسم العميل</span><strong>${escapeHTML(client.name)}</strong></div>
    <div class="print-doc-row"><span>الهوية القومية</span><strong>${escapeHTML(client.nationalId) || '—'}</strong></div>
    <div class="print-doc-row"><span>رقم الهاتف</span><strong>${escapeHTML(client.phone)}</strong></div>
    <div class="print-doc-row"><span>العنوان</span><strong>${escapeHTML(client.address) || '—'}</strong></div>

    <div style="margin-top:14px; padding:10px 12px; background:#ecfdf5; border-radius:8px; display:flex; justify-content:space-around; text-align:center; font-size:0.85rem;">
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي قيمة العقود</div><strong>${grandTotalValue.toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي المسدد</div><strong style="color:#059669;">${grandTotalPaid.toLocaleString()} ج.م</strong></div>
      <div><div style="color:#64748b; font-size:0.7rem;">إجمالي المتبقي</div><strong style="color:#d97706;">${grandTotalRemaining.toLocaleString()} ج.م</strong></div>
    </div>

    ${contractsBlocks}

    <div class="print-doc-signatures">
      <div>توقيع مسؤول الحسابات: ______________</div>
      <div>توقيع العميل: ______________</div>
    </div>
    <div class="print-doc-footer">تم إصدار هذا الكشف إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${new Date().toLocaleString('ar-EG')}</div>
  `;

  printHTML(html);
  logAction('طباعة كشف حساب', `طباعة كشف حساب شامل للعميل ${client.name}`);
};

// ================= عقد بيع بالتقسيط الرسمي (Formal Sale Contract) =================
window.printFormalContract = function(contractId) {
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;
  const client = db.clients.find(c => c.id === contract.clientId);
  if (!client) return;

  const companyName = db.settings.companyName || 'شركة SKY';
  const contractInsts = db.installments
    .filter(i => i.contractId === contract.id)
    .sort((a, b) => (a.installmentNum || 0) - (b.installmentNum || 0));

  const fineDescription = contract.fineType === 'percent'
    ? `نسبة ${contract.fineValue}% شهرياً من قيمة القسط عن كل شهر تأخير كامل`
    : `مبلغ ${contract.fineValue} ج.م عن كل يوم تأخير`;

  const instRows = contractInsts.map(inst => `
    <tr>
      <td>قسط ${inst.installmentNum}</td>
      <td>${escapeHTML(inst.dueDate)}</td>
      <td>${inst.amount.toLocaleString()} ج.م</td>
    </tr>
  `).join('');

  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#5856d6;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>رقم العقد:</strong> ${escapeHTML(contract.id.replace('con-', ''))}</div>
        <div><strong>تاريخ التحرير:</strong> ${escapeHTML(contract.startDate)}</div>
      </div>
    </div>
    <div class="print-doc-title">عقد بيع بالتقسيط</div>

    <p style="font-size:0.85rem; line-height:1.8; color:#334155;">
      تم الاتفاق بتاريخ <strong>${escapeHTML(contract.startDate)}</strong> بين كل من:
    </p>

    <div style="margin-top:6px; padding:10px 12px; background:#f8fafc; border-radius:8px;">
      <strong style="font-size:0.85rem;">الطرف الأول (البائع):</strong> ${escapeHTML(companyName)}
    </div>

    <div style="margin-top:10px; padding:10px 12px; background:#f8fafc; border-radius:8px;">
      <strong style="font-size:0.85rem;">الطرف الثاني (المشتري):</strong>
      <div class="print-doc-row"><span>الاسم</span><strong>${escapeHTML(client.name)}</strong></div>
      <div class="print-doc-row"><span>الرقم القومي</span><strong>${escapeHTML(client.nationalId) || '—'}</strong></div>
      <div class="print-doc-row"><span>الهاتف</span><strong>${escapeHTML(client.phone)}</strong></div>
      <div class="print-doc-row"><span>العنوان</span><strong>${escapeHTML(client.address) || '—'}</strong></div>
    </div>

    <div style="margin-top:10px; padding:10px 12px; background:#f8fafc; border-radius:8px;">
      <strong style="font-size:0.85rem;">الطرف الثالث (الضامن):</strong>
      <div class="print-doc-row"><span>الاسم</span><strong>${escapeHTML(client.guarantorName) || '—'}</strong></div>
      <div class="print-doc-row"><span>الرقم القومي</span><strong>${escapeHTML(client.guarantorNationalId) || '—'}</strong></div>
      <div class="print-doc-row"><span>الهاتف</span><strong>${escapeHTML(client.guarantorPhone) || '—'}</strong></div>
      <div class="print-doc-row"><span>صلة القرابة</span><strong>${escapeHTML(client.guarantorRelation) || '—'}</strong></div>
    </div>

    <p style="font-size:0.8rem; color:#64748b; margin-top:10px;">تم الاتفاق على البنود التالية:</p>

    <div style="margin-top:6px;">
      <div class="print-doc-row"><span>١- محل التعاقد (الجهاز)</span><strong>${escapeHTML(contract.deviceInfo)}</strong></div>
      <div class="print-doc-row"><span>٢- السعر الكاش للجهاز</span><strong>${contract.cashPrice.toLocaleString()} ج.م</strong></div>
      <div class="print-doc-row"><span>٣- الدفعة المقدمة</span><strong>${safeNum(contract.downPayment).toLocaleString()} ج.م</strong></div>
      <div class="print-doc-row"><span>٤- قيمة الزيادة/الفائدة على التقسيط</span><strong>${safeNum(contract.interestAmount).toLocaleString()} ج.م</strong></div>
      <div class="print-doc-row"><span>٥- إجمالي قيمة العقد</span><strong>${contract.totalValue.toLocaleString()} ج.م</strong></div>
      <div class="print-doc-row"><span>٦- مدة التقسيط</span><strong>${contract.duration} شهر</strong></div>
      <div class="print-doc-row"><span>٧- قيمة القسط الشهري</span><strong>${contract.monthlyInstallment.toLocaleString()} ج.م</strong></div>
      <div class="print-doc-row"><span>٨- غرامة التأخير في حالة عدم السداد بالموعد</span><strong>${escapeHTML(fineDescription)}</strong></div>
    </div>

    <p style="font-size:0.78rem; line-height:1.9; color:#334155; margin-top:14px; border-top:1px solid #e2e8f0; padding-top:10px;">
      <strong>٩- شروط عامة:</strong><br>
      أ) تظل ملكية الجهاز المذكور أعلاه للطرف الأول (البائع) ولا تنتقل ملكيته للطرف الثاني (المشتري) إلا بعد سداد كامل قيمة العقد المذكورة أعلاه.<br>
      ب) في حالة تأخر الطرف الثاني عن سداد أي قسط في موعده، يحق للطرف الأول تطبيق غرامة التأخير المذكورة في البند الثامن.<br>
      ج) في حالة توقف الطرف الثاني عن السداد لمدة تزيد عن الحد المتعارف عليه بين الطرفين، يحق للطرف الأول استرجاع الجهاز المذكور دون رد قيمة الأقساط المسددة سابقاً، ودون إخلال بحق الطرف الأول في المطالبة بأي مستحقات أخرى.<br>
      د) يلتزم الطرف الثالث (الضامن) بالتضامن مع الطرف الثاني في سداد كامل قيمة العقد في حالة تعثر الطرف الثاني عن السداد.<br>
      هـ) يقر الطرفان الثاني والثالث بالاطلاع على جميع بنود هذا العقد والموافقة عليها والالتزام بها.
    </p>

    <p style="font-size:0.7rem; color:#94a3b8; margin-top:8px;">
      * هذا العقد نموذج عام لتوثيق عملية البيع بالتقسيط، ويُنصح بمراجعته من محامٍ مختص قبل الاعتماد النهائي عليه في التعاملات الرسمية، للتأكد من توافقه مع القوانين المعمول بها.
    </p>

    <table class="print-doc-table" style="margin-top:12px;">
      <thead><tr><th>رقم القسط</th><th>تاريخ الاستحقاق</th><th>القيمة</th></tr></thead>
      <tbody>${instRows}</tbody>
    </table>

    <div class="print-doc-signatures" style="margin-top:20px;">
      <div>توقيع الطرف الأول (البائع): ______________</div>
      <div>توقيع الطرف الثاني (المشتري): ______________</div>
    </div>
    <div class="print-doc-signatures" style="margin-top:10px;">
      <div>توقيع الطرف الثالث (الضامن): ______________</div>
      <div></div>
    </div>
    <div class="print-doc-footer">تم إصدار هذا العقد إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${new Date().toLocaleString('ar-EG')}</div>
  `;

  printHTML(html);
  logAction('طباعة عقد رسمي', `طباعة عقد البيع الرسمي رقم ${contractId.replace('con-', '')} للعميل ${client.name}`);
};

window.openBase64InPreviewModal = function(title, base64) {
  document.getElementById('preview-modal-img').src = base64;
  document.getElementById('preview-modal-title').textContent = title;
  openModal('image-preview-modal');
};

// ================= CONTRACT DETAILS VIEWER =================
window.viewContractDetails = function(contractId) {
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;

  const contractInsts = db.installments
    .filter(inst => inst.contractId === contractId)
    .sort((a, b) => (a.installmentNum || 0) - (b.installmentNum || 0));

  let instRows = contractInsts.map(inst => {
    const statusInfo = getInstallmentOverdueStatus(inst);
    return `
      <tr class="hover:bg-slate-50 divide-y divide-slate-100 text-xs">
        <td class="p-3 font-bold">قسط ${inst.installmentNum}</td>
        <td class="p-3 font-mono">${inst.dueDate}</td>
        <td class="p-3 font-mono font-bold">${inst.amount.toLocaleString()} ج.م</td>
        <td class="p-3"><span class="badge ${statusInfo.statusColor} font-bold">${statusInfo.statusText}</span></td>
        <td class="p-3 font-mono font-bold text-teal-600">${statusInfo.fine > 0 ? `${statusInfo.fine.toLocaleString()} ج.م` : '0'}</td>
        <td class="p-3 font-mono font-bold text-slate-800">${statusInfo.totalDue.toLocaleString()} ج.م</td>
        <td class="p-3 text-center">
          ${inst.status !== 'paid' ? `
            <button onclick="document.getElementById('contract-detail-modal').remove(); collectInstallmentBtn('${inst.id}')" class="px-3 py-1 bg-slate-900 text-white rounded text-xs font-bold hover:bg-slate-800 transition-colors">تحصيل</button>
          ` : `
            <span class="text-emerald-600 font-bold"><i class="ph ph-check"></i> مدفوع</span>
          `}
        </td>
      </tr>
    `;
  }).join('');

  const detailDiv = document.createElement('div');
  detailDiv.id = 'contract-detail-modal';
  detailDiv.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4';
  detailDiv.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-4xl shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
      <div class="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
        <h4 class="font-bold text-lg text-slate-800 flex items-center gap-2"><i class="ph ph-file-text text-teal-600"></i> تفاصيل وجدولة أقساط العقد رقم: ${escapeHTML(contract.id.replace('con-', ''))}</h4>
        <button onclick="document.getElementById('contract-detail-modal').remove()" class="text-slate-400 hover:text-slate-600"><i class="ph ph-x text-lg"></i></button>
      </div>
      ${contract.upgradedFromContractId ? `
        <div class="mb-3 p-2.5 bg-violet-50 border border-violet-100 rounded-lg text-xs text-violet-700 flex items-center gap-2">
          <i class="ph ph-arrow-fat-line-up"></i>
          <span>هذا العقد ناتج عن ترقية العقد رقم ${escapeHTML(contract.upgradedFromContractId.replace('con-', ''))}</span>
        </div>
      ` : ''}
      ${contract.upgradedToContractId ? `
        <div class="mb-3 p-2.5 bg-violet-50 border border-violet-100 rounded-lg text-xs text-violet-700 flex items-center gap-2">
          <i class="ph ph-arrow-fat-line-up"></i>
          <span>تم ترقية هذا العقد إلى العقد رقم ${escapeHTML(contract.upgradedToContractId.replace('con-', ''))}</span>
        </div>
      ` : ''}
      <div class="flex-1 overflow-y-auto space-y-4">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl text-xs">
          <p><strong>العميل المشتري:</strong> ${escapeHTML(contract.clientName)}</p>
          <p><strong>المحصل المسند:</strong> ${escapeHTML(contract.collectorName)}</p>
          <p><strong>الجهاز المباع:</strong> ${escapeHTML(contract.deviceInfo)}</p>
          <p><strong>تاريخ العقد:</strong> ${escapeHTML(contract.startDate)}</p>
          <p><strong>قيمة العقد الإجمالية:</strong> ${contract.totalValue.toLocaleString()} ج.م</p>
          <p><strong>الدفعة المقدمة:</strong> ${contract.downPayment.toLocaleString()} ج.م</p>
          <p><strong>المبلغ المتبقي للتقسيط:</strong> ${contract.remainingAmount.toLocaleString()} ج.م</p>
          <p><strong>قيمة القسط الشهري:</strong> ${contract.monthlyInstallment.toLocaleString()} ج.م</p>
        </div>

        <div class="table-scroll-wrapper">
          <table class="w-full text-right border-collapse">
            <thead>
              <tr class="bg-slate-100 border-b border-slate-200 text-slate-700 text-xs font-bold">
                <th class="p-3">رقم الدفعة</th>
                <th class="p-3">تاريخ الاستحقاق</th>
                <th class="p-3">قيمة القسط الأصلية</th>
                <th class="p-3">الحالة والمدة</th>
                <th class="p-3">غرامة التأخير</th>
                <th class="p-3">إجمالي القيمة المطلوبة</th>
                <th class="p-3 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              ${instRows}
            </tbody>
          </table>
        </div>
      </div>
      <div class="pt-3 border-t border-slate-100 flex justify-between items-center">
        ${contractInsts.some(i => i.status !== 'paid') ? `
          <button onclick="document.getElementById('contract-detail-modal').remove(); openRescheduleModal('${contract.id}')" class="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-bold flex items-center gap-1 admin-only">
            <i class="ph ph-calendar-x"></i> إعادة جدولة الأقساط المتبقية
          </button>
        ` : '<span></span>'}
        <button onclick="document.getElementById('contract-detail-modal').remove()" class="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">إغلاق</button>
      </div>
    </div>
  `;
  document.body.appendChild(detailDiv);
  updateUIForRole();
};

// ================= ROUTING & TAB NAVIGATION =================
// ================= إعادة جدولة الأقساط المتبقية على عقد =================
window.openRescheduleModal = function(contractId) {
  if (!isAdmin()) return;
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;

  const unpaidInsts = db.installments.filter(i => i.contractId === contractId && i.status !== 'paid');
  if (unpaidInsts.length === 0) {
    alert('كل أقساط العقد ده مسددة بالكامل، مفيش حاجة تتعاد جدولتها.');
    return;
  }

  const remainingBalance = unpaidInsts.reduce((sum, i) => sum + Math.max(0, safeNum(i.amount) - safeNum(i.paidAmount)), 0);

  const modal = document.createElement('div');
  modal.id = 'reschedule-modal';
  modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
        <h4 class="font-bold text-slate-800 text-lg">إعادة جدولة الأقساط المتبقية</h4>
        <button onclick="document.getElementById('reschedule-modal').remove()" class="text-slate-400 hover:text-slate-600"><i class="ph ph-x text-lg"></i></button>
      </div>
      <div class="p-3 bg-slate-50 rounded-lg text-sm mb-4 space-y-1">
        <p>عدد الأقساط المتبقية حالياً: <strong>${unpaidInsts.length}</strong></p>
        <p>إجمالي المبلغ المتبقي (المطلوب إعادة جدولته): <strong class="text-teal-600">${remainingBalance.toLocaleString()} ج.م</strong></p>
      </div>
      <div class="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 mb-4 flex items-start gap-2">
        <i class="ph ph-warning mt-0.5"></i>
        <span>هيتم حذف الأقساط المتبقية الحالية (اللي لسه ماتسددتش) واستبدالها بجدول جديد. الأقساط اللي اتسددت خلاص مش هتتأثر خالص.</span>
      </div>
      <div>
        <label class="form-label">عدد الأقساط الجديد</label>
        <input type="number" id="reschedule-new-duration" min="1" value="${unpaidInsts.length}" class="form-input" oninput="updateReschedulePreview(${remainingBalance})">
        <p class="text-xs text-slate-500 mt-1">قيمة القسط الشهري الجديد التقريبية: <span id="reschedule-preview" class="font-bold text-slate-800">${(remainingBalance / unpaidInsts.length).toLocaleString(undefined, {maximumFractionDigits: 2})}</span> ج.م</p>
      </div>
      <div class="flex justify-end gap-2 pt-4">
        <button onclick="document.getElementById('reschedule-modal').remove()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">إلغاء</button>
        <button onclick="confirmReschedule('${contractId}')" class="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold shadow-md">تأكيد إعادة الجدولة</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

window.updateReschedulePreview = function(remainingBalance) {
  const n = parseInt(document.getElementById('reschedule-new-duration').value) || 1;
  document.getElementById('reschedule-preview').textContent = (remainingBalance / n).toLocaleString(undefined, {maximumFractionDigits: 2});
};

window.confirmReschedule = async function(contractId) {
  await runWithActionLock(`reschedule-${contractId}`, async () => {
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;

  const newDuration = parseInt(document.getElementById('reschedule-new-duration').value);
  if (!newDuration || newDuration < 1) {
    alert('⚠️ من فضلك اكتب عدد أقساط صحيح (1 على الأقل).');
    return;
  }

  const unpaidInsts = db.installments.filter(i => i.contractId === contractId && i.status !== 'paid');
  const remainingBalance = unpaidInsts.reduce((sum, i) => sum + Math.max(0, safeNum(i.amount) - safeNum(i.paidAmount)), 0);
  const lastPaidNum = db.installments
    .filter(i => i.contractId === contractId && i.status === 'paid')
    .reduce((max, i) => Math.max(max, i.installmentNum || 0), 0);

  if (!(await customConfirm(`هيتم استبدال ${unpaidInsts.length} قسط بـ ${newDuration} قسط جديد، بإجمالي ${remainingBalance.toLocaleString()} ج.م. متأكد؟`))) {
    return;
  }

  // حذف الأقساط القديمة غير المسددة محلياً (فايربيس هيتزامن دفعة واحدة تحت)
  const oldIds = unpaidInsts.map(i => i.id);
  db.installments = db.installments.filter(i => !oldIds.includes(i.id));

  const monthly = parseFloat((remainingBalance / newDuration).toFixed(2));
  const startFrom = new Date();
  const sampleInst = unpaidInsts[0];
  const newInsts = [];

  for (let i = 1; i <= newDuration; i++) {
    const dueDate = new Date(startFrom);
    dueDate.setMonth(startFrom.getMonth() + i);
    const installmentAmount = (i === newDuration)
      ? parseFloat((remainingBalance - monthly * (newDuration - 1)).toFixed(2))
      : monthly;

    const newInst = {
      id: `${contractId}_resched_${i}_${Date.now()}`,
      contractId: contractId,
      clientId: contract.clientId,
      clientName: contract.clientName,
      clientPhone: sampleInst.clientPhone,
      guarantorName: sampleInst.guarantorName,
      guarantorPhone: sampleInst.guarantorPhone,
      collectorName: contract.collectorName,
      installmentNum: lastPaidNum + i,
      amount: installmentAmount,
      dueDate: dueDate.toISOString().split('T')[0],
      status: 'pending',
      paidAmount: 0,
      paidDate: '',
      receiptId: '',
      delayFines: 0
    };
    db.installments.push(newInst);
    newInsts.push(newInst);
  }

  // إجراء واحد دفعي (batch) جاهز أصلاً في النظام: بيحذف الأقساط الغير
  // مسددة القديمة لنفس العقد ويكتب الجديدة في عملية واحدة آمنة.
  await syncWithAppsScript('regenerateInstallments', { contractId, installments: newInsts });

  contract.monthlyInstallment = monthly;
  await syncWithAppsScript('updateContract', contract);

  logAction('إعادة جدولة عقد', `إعادة جدولة العقد ${contractId} — ${unpaidInsts.length} قسط قديم استُبدل بـ ${newDuration} قسط جديد بإجمالي ${remainingBalance.toLocaleString()} ج.م`);

  document.getElementById('reschedule-modal').remove();
  renderContracts();
  renderCollections();
  showToast('✅ تم إعادة جدولة الأقساط بنجاح', 'success');
  });
};

// ================= سداد مبكر (Early Settlement) =================
window.openEarlySettlementModal = function(contractId) {
  if (!isAdmin()) {
    alert('⛔ السداد المبكر مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;

  const unpaidInsts = db.installments.filter(i => i.contractId === contractId && i.status !== 'paid');
  if (unpaidInsts.length === 0) {
    alert('العقد ده مسدد بالكامل بالفعل، مفيش حاجة للسداد المبكر.');
    return;
  }

  const remainingBalance = unpaidInsts.reduce((sum, i) => sum + Math.max(0, safeNum(i.amount) - safeNum(i.paidAmount)), 0);

  const modal = document.createElement('div');
  modal.id = 'early-settlement-modal';
  modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
        <h4 class="font-bold text-slate-800 text-lg">سداد مبكر — إغلاق العقد</h4>
        <button onclick="document.getElementById('early-settlement-modal').remove()" class="text-slate-400 hover:text-slate-600"><i class="ph ph-x text-lg"></i></button>
      </div>
      <div class="p-3 bg-slate-50 rounded-lg text-sm mb-4 space-y-1">
        <p>العميل: <strong>${escapeHTML(contract.clientName)}</strong></p>
        <p>عدد الأقساط المتبقية: <strong>${unpaidInsts.length}</strong></p>
        <p>إجمالي المتبقي بدون خصم: <strong class="text-teal-600">${remainingBalance.toLocaleString()} ج.م</strong></p>
      </div>
      <div>
        <label class="form-label">خصم على السداد المبكر (اختياري، ج.م)</label>
        <input type="number" id="early-settlement-discount" min="0" max="${remainingBalance}" step="0.01" value="0" class="form-input" oninput="updateEarlySettlementPreview(${remainingBalance})">
      </div>
      <div class="p-3 bg-teal-50 border border-teal-100 rounded-lg text-sm mt-3">
        <p>المبلغ النهائي المطلوب تحصيله الآن: <strong id="early-settlement-final" class="text-teal-700 text-base">${remainingBalance.toLocaleString()} ج.م</strong></p>
      </div>
      <div class="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 my-3 flex items-start gap-2">
        <i class="ph ph-warning mt-0.5"></i>
        <span>هيتم تعليم كل الأقساط المتبقية كمدفوعة بالكامل، وتسجيل المبلغ النهائي كتحصيل واحد في الخزينة، وإغلاق العقد كـ"مسدد مبكراً". الأقساط اللي اتسددت خلاص مش هتتأثر.</span>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <button onclick="document.getElementById('early-settlement-modal').remove()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">إلغاء</button>
        <button onclick="confirmEarlySettlement('${contractId}', ${remainingBalance})" class="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold shadow-md">تأكيد السداد المبكر</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

window.updateEarlySettlementPreview = function(remainingBalance) {
  const discount = safeNum(document.getElementById('early-settlement-discount').value);
  const final = Math.max(0, remainingBalance - discount);
  document.getElementById('early-settlement-final').textContent = `${final.toLocaleString()} ج.م`;
};

window.confirmEarlySettlement = async function(contractId, remainingBalance) {
  await runWithActionLock(`settlement-${contractId}`, async () => {
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;

  const discount = Math.max(0, safeNum(document.getElementById('early-settlement-discount').value));
  const finalAmount = Math.max(0, remainingBalance - discount);

  if (!(await customConfirm(`هيتم تحصيل ${finalAmount.toLocaleString()} ج.م وإغلاق العقد نهائياً. متأكد؟`))) return;

  const unpaidInsts = db.installments.filter(i => i.contractId === contractId && i.status !== 'paid');
  const today = new Date().toISOString().split('T')[0];
  const settlementId = `settle-${Date.now()}`;

  const updatedInstallments = unpaidInsts.map(i => {
    i.status = 'paid';
    i.paidAmount = i.amount;
    i.paidDate = today;
    i.receiptId = settlementId;
    i.notes = `تم السداد ضمن تسوية مبكرة للعقد بتاريخ ${today}${discount > 0 ? ` (خصم ${discount.toLocaleString()} ج.م على إجمالي العقد)` : ''}`;
    return i;
  });

  const transaction = {
    id: settlementId,
    type: 'collection',
    amount: finalAmount,
    category: 'سداد مبكر',
    method: 'cash',
    details: `سداد مبكر لإغلاق عقد ${contract.clientName} (${contractId.replace('con-', '')})${discount > 0 ? ` — بعد خصم ${discount.toLocaleString()} ج.م` : ''}`,
    user: currentUser ? currentUser.name : 'مجهول',
    timestamp: nowTimestamp()
  };
  db.treasuryTransactions.unshift(transaction);
  contract.status = 'settled_early';

  await syncWithAppsScript('settleContractEarly', { contractId, updatedInstallments, transaction });

  logAction('سداد مبكر', `إغلاق عقد ${contract.clientName} مبكراً — تحصيل ${finalAmount.toLocaleString()} ج.م${discount > 0 ? ` (خصم ${discount.toLocaleString()} ج.م)` : ''}، وتعليم ${unpaidInsts.length} قسط كمدفوع`);

  document.getElementById('early-settlement-modal').remove();
  renderContracts();
  renderCollections();
  renderTreasury();
  renderDashboard();
  showToast('✅ تم السداد المبكر وإغلاق العقد بنجاح', 'success');
  });
};

// ================= استرجاع الجهاز (تعثر العميل) =================
window.openRepossessModal = function(contractId) {
  if (!isAdmin()) {
    alert('⛔ استرجاع الجهاز مخصص للمشرف (ADMIN) فقط.');
    return;
  }
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;

  const unpaidInsts = db.installments.filter(i => i.contractId === contractId && i.status !== 'paid');
  const paidInsts = db.installments.filter(i => i.contractId === contractId && i.status === 'paid');
  const paidSoFar = paidInsts.reduce((sum, i) => sum + safeNum(i.paidAmount || i.amount), 0);

  const modal = document.createElement('div');
  modal.id = 'repossess-modal';
  modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
        <h4 class="font-bold text-slate-800 text-lg">استرجاع الجهاز — تعثر العميل</h4>
        <button onclick="document.getElementById('repossess-modal').remove()" class="text-slate-400 hover:text-slate-600"><i class="ph ph-x text-lg"></i></button>
      </div>
      <div class="p-3 bg-slate-50 rounded-lg text-sm mb-4 space-y-1">
        <p>العميل: <strong>${escapeHTML(contract.clientName)}</strong></p>
        <p>الجهاز: <strong>${escapeHTML(contract.deviceInfo)}</strong></p>
        <p>تم تحصيله فعلاً: <strong class="text-teal-600">${paidSoFar.toLocaleString()} ج.م</strong> (${paidInsts.length} قسط) — لن يُرد للعميل</p>
        <p>الأقساط المتبقية اللي هتتلغى: <strong class="text-rose-600">${unpaidInsts.length} قسط</strong></p>
      </div>
      <div class="p-3 bg-rose-50 border border-rose-100 rounded-lg text-xs text-rose-700 mb-4 flex items-start gap-2">
        <i class="ph ph-warning mt-0.5"></i>
        <span>هيتم: (١) إلغاء كل الأقساط المتبقية غير المسددة نهائياً، (٢) إرجاع الجهاز لحالة "متاح" في المخزون عشان تقدر تبيعه تاني، (٣) إغلاق العقد كـ"متعثر". الأقساط اللي اتحصّلت قبل كده مش بترجع للعميل (مش استرداد/إلغاء بيع).</span>
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <button onclick="document.getElementById('repossess-modal').remove()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">إلغاء</button>
        <button onclick="confirmRepossessDevice('${contractId}')" class="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-semibold shadow-md">تأكيد الاسترجاع</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
};

window.confirmRepossessDevice = async function(contractId) {
  await runWithActionLock(`repossess-${contractId}`, async () => {
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;

  const unpaidInsts = db.installments.filter(i => i.contractId === contractId && i.status !== 'paid');

  if (!(await customConfirm(`هيتم إلغاء ${unpaidInsts.length} قسط نهائياً وإرجاع الجهاز للمخزون. الإجراء ده لا يمكن التراجع عنه. متأكد؟`, 'تأكيد نهائي'))) return;

  const oldIds = unpaidInsts.map(i => i.id);
  db.installments = db.installments.filter(i => !oldIds.includes(i.id));

  const dev = db.inventory.find(d => d.id === contract.deviceId);
  if (dev) {
    dev.status = 'available';
    dev.soldTo = '';
    addDeviceHistory(dev, 'استرجاع (تعثر عميل)', `تم استرجاع القطعة من ${contract.clientName} بسبب التعثر في السداد، وإلغاء ${unpaidInsts.length} قسط متبقي.`);
  }
  contract.status = 'defaulted';

  await syncWithAppsScript('repossessDevice', { contractId, deviceId: contract.deviceId });

  logAction('استرجاع جهاز - تعثر', `تعثر العميل ${contract.clientName} في عقد ${contractId.replace('con-', '')} — إلغاء ${unpaidInsts.length} قسط واسترجاع الجهاز للمخزون`);

  document.getElementById('repossess-modal').remove();
  renderContracts();
  renderCollections();
  renderInventory();
  renderClientBalances();
  renderDashboard();
  showToast('✅ تم استرجاع الجهاز وإغلاق العقد', 'success');
  });
};

// ================= ترقية العقد (استبدال جهاز طوعي) =================
// مختلفة عن الاسترجاع: العميل عايز يستبدل جهازه بجهاز أحدث طوعًا وهو
// لسه بيسدد كويس، مش متعثر. المتبقي على العقد القديم بيترحّل كـ"دين إضافي"
// على العقد الجديد بدل ما يتحصّل بشكل منفصل.
window.openUpgradeContractModal = function(contractId) {
  if (!isAdmin()) {
    alert('⛔ ترقية العقد مخصصة للمشرف (ADMIN) فقط.');
    return;
  }
  const contract = db.contracts.find(c => c.id === contractId);
  if (!contract) return;

  const unpaidInsts = db.installments.filter(i => i.contractId === contractId && i.status !== 'paid');
  const remainingBalance = unpaidInsts.reduce((sum, i) => sum + Math.max(0, safeNum(i.amount) - safeNum(i.paidAmount)), 0);

  const modal = document.createElement('div');
  modal.id = 'upgrade-contract-modal';
  modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
        <h4 class="font-bold text-slate-800 text-lg">ترقية الجهاز (استبدال طوعي)</h4>
        <button onclick="document.getElementById('upgrade-contract-modal').remove()" class="text-slate-400 hover:text-slate-600"><i class="ph ph-x text-lg"></i></button>
      </div>
      <div class="p-3 bg-slate-50 rounded-lg text-sm mb-4 space-y-1">
        <p>العميل: <strong>${escapeHTML(contract.clientName)}</strong></p>
        <p>الجهاز الحالي: <strong>${escapeHTML(contract.deviceInfo)}</strong></p>
        <p>المتبقي على العقد الحالي: <strong class="text-amber-600">${remainingBalance.toLocaleString()} ج.م</strong> — هيترحّل على العقد الجديد</p>
      </div>

      <div class="relative mb-3">
        <label class="form-label">الجهاز الجديد</label>
        <input type="text" id="upgrade-device-search" class="form-input" placeholder="اكتب اسم الجهاز أو السيريال..." autocomplete="off">
        <input type="hidden" id="upgrade-device-picked-id">
        <div id="upgrade-device-results" class="hidden absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"></div>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="form-label">خصم استرداد الجهاز القديم (اختياري)</label>
          <input type="number" id="upgrade-tradein-credit" min="0" step="0.01" value="0" class="form-input">
        </div>
        <div>
          <label class="form-label">مدة التقسيط الجديدة (شهور)</label>
          <input type="number" id="upgrade-new-duration" min="1" max="60" value="${contract.duration}" class="form-input">
        </div>
      </div>

      <div id="upgrade-preview-box" class="p-3 bg-teal-50 border border-teal-100 rounded-lg text-sm mb-3 hidden">
        <p>إجمالي الممول على العقد الجديد: <strong id="upgrade-preview-total" class="text-teal-700"></strong></p>
        <p>القسط الشهري الجديد التقريبي: <strong id="upgrade-preview-monthly" class="text-teal-700"></strong></p>
      </div>

      <div class="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 mb-4 flex items-start gap-2">
        <i class="ph ph-warning mt-0.5"></i>
        <span>هيتم إغلاق العقد الحالي (الأقساط المسددة تفضل زي ما هي)، وإرجاع الجهاز القديم للمخزون، وفتح عقد جديد بالمتبقي + سعر الجهاز الجديد ناقص أي خصم استرداد.</span>
      </div>

      <div class="flex justify-end gap-2">
        <button onclick="document.getElementById('upgrade-contract-modal').remove()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm">إلغاء</button>
        <button onclick="confirmUpgradeContract('${contractId}', ${remainingBalance})" class="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold shadow-md">تأكيد الترقية</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  setupSearchableSelect({
    searchInputId: 'upgrade-device-search',
    hiddenInputId: 'upgrade-device-picked-id',
    resultsId: 'upgrade-device-results',
    getItems: (query) => {
      const q = query.toLowerCase();
      const available = db.inventory.filter(d => d.status === 'available' && d.id !== contract.deviceId);
      const list = !q ? available : available.filter(d =>
        (d.name || '').toLowerCase().includes(q) || (d.brand || '').toLowerCase().includes(q) || (d.serial || '').toLowerCase().includes(q)
      );
      return list.slice(0, 200);
    },
    renderLabel: (d) => `${d.brand} ${d.name} (SN: ${d.serial})`,
    renderSubLabel: (d) => `سعر البيع: ${safeNum(d.sellingPrice).toLocaleString()} ج.م`,
    onChange: (d) => updateUpgradePreview(remainingBalance, d.sellingPrice)
  });

  document.getElementById('upgrade-tradein-credit').addEventListener('input', () => {
    const devId = document.getElementById('upgrade-device-picked-id').value;
    const dev = db.inventory.find(d => d.id === devId);
    if (dev) updateUpgradePreview(remainingBalance, dev.sellingPrice);
  });
  document.getElementById('upgrade-new-duration').addEventListener('input', () => {
    const devId = document.getElementById('upgrade-device-picked-id').value;
    const dev = db.inventory.find(d => d.id === devId);
    if (dev) updateUpgradePreview(remainingBalance, dev.sellingPrice);
  });
};

function updateUpgradePreview(remainingBalance, newDevicePrice) {
  const tradeInCredit = safeNum(document.getElementById('upgrade-tradein-credit').value);
  const duration = Math.max(1, parseInt(document.getElementById('upgrade-new-duration').value) || 1);
  const total = Math.max(0, remainingBalance + safeNum(newDevicePrice) - tradeInCredit);
  const monthly = total / duration;

  document.getElementById('upgrade-preview-total').textContent = `${total.toLocaleString()} ج.م`;
  document.getElementById('upgrade-preview-monthly').textContent = `${monthly.toFixed(2).toLocaleString()} ج.م`;
  document.getElementById('upgrade-preview-box').classList.remove('hidden');
}

window.confirmUpgradeContract = async function(oldContractId, remainingBalance) {
  await runWithActionLock(`upgrade-${oldContractId}`, async () => {
  const oldContract = db.contracts.find(c => c.id === oldContractId);
  const client = db.clients.find(c => c.id === oldContract.clientId);
  const newDeviceId = document.getElementById('upgrade-device-picked-id').value;
  const newDevice = db.inventory.find(d => d.id === newDeviceId);
  const tradeInCredit = safeNum(document.getElementById('upgrade-tradein-credit').value);
  const newDuration = Math.max(1, parseInt(document.getElementById('upgrade-new-duration').value) || 1);

  if (!newDevice) {
    alert('من فضلك اختر الجهاز الجديد أولاً.');
    return;
  }
  const totalToFinance = Math.max(0, remainingBalance + safeNum(newDevice.sellingPrice) - tradeInCredit);
  const monthly = parseFloat((totalToFinance / newDuration).toFixed(2));

  if (!(await customConfirm(`هيتم إغلاق العقد الحالي وفتح عقد جديد بإجمالي ${totalToFinance.toLocaleString()} ج.م على ${newDuration} قسط (${monthly.toLocaleString()} ج.م شهريًا). متأكد؟`))) return;

  // 1. إغلاق العقد القديم: إلغاء الأقساط المتبقية وإرجاع الجهاز القديم للمخزون
  const oldUnpaidInsts = db.installments.filter(i => i.contractId === oldContractId && i.status !== 'paid');
  const oldIds = oldUnpaidInsts.map(i => i.id);
  db.installments = db.installments.filter(i => !oldIds.includes(i.id));

  const oldDevice = db.inventory.find(d => d.id === oldContract.deviceId);
  if (oldDevice) {
    oldDevice.status = 'available';
    oldDevice.soldTo = '';
    addDeviceHistory(oldDevice, 'ترقية العميل لجهاز جديد', `تم استرجاع القطعة من ${oldContract.clientName} ضمن عملية ترقية طوعية لجهاز جديد.`);
  }

  // 2. فتح عقد جديد بنفس منطق إنشاء عقد عادي
  const newContractId = `con-${Math.floor(100000 + Math.random() * 900000)}`;
  oldContract.status = 'upgraded';
  oldContract.upgradedToContractId = newContractId; // FIX: ربط رجوعي عشان تقدر تتبع العقد الجديد من القديم كمان
  newDevice.status = 'sold_installment';
  newDevice.soldTo = client.name;

  const newContract = {
    id: newContractId,
    createdAt: Date.now(),
    clientId: oldContract.clientId,
    clientName: client.name,
    clientPhone: client.phone,
    deviceId: newDevice.id,
    deviceInfo: `${newDevice.brand} ${newDevice.name}`,
    cashPrice: newDevice.sellingPrice,
    // FIX: كان العقد الجديد الناتج من "ترقية جهاز" مش بيسجّل costPrice
    // مباشرة زي باقي العقود (كان بيعتمد على استرجاعها لاحقاً من المخزون
    // كحل احتياطي، وده هش لو تكلفة الجهاز اتعدّلت بعدين). دلوقتي بيتسجل
    // زي أي عقد عادي وقت الإنشاء نفسه.
    costPrice: safeNum(newDevice.costPrice),
    interestType: 'none',
    interestValue: 0,
    interestAmount: 0,
    totalValue: totalToFinance,
    downPayment: 0,
    remainingAmount: totalToFinance,
    monthlyInstallment: monthly,
    duration: newDuration,
    graceDays: oldContract.graceDays || 3,
    fineType: oldContract.fineType || 'percent',
    fineValue: oldContract.fineValue || 5,
    collectorId: oldContract.collectorId,
    collectorName: oldContract.collectorName,
    startDate: new Date().toISOString().split('T')[0],
    status: 'active',
    upgradedFromContractId: oldContractId
  };
  db.contracts.unshift(newContract);

  const newInstallments = [];
  const startBase = new Date(newContract.startDate);
  for (let i = 1; i <= newDuration; i++) {
    const dueDate = new Date(startBase);
    dueDate.setMonth(startBase.getMonth() + (i - 1));
    const isLast = i === newDuration;
    const inst = {
      id: `${newContractId}_${i}`,
      contractId: newContractId,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      guarantorName: client.guarantorName || '',
      guarantorPhone: client.guarantorPhone || '',
      collectorName: newContract.collectorName,
      installmentNum: i,
      amount: isLast ? parseFloat((totalToFinance - monthly * (newDuration - 1)).toFixed(2)) : monthly,
      dueDate: dueDate.toISOString().split('T')[0],
      status: 'pending',
      paidAmount: 0,
      paidDate: '',
      receiptId: '',
      delayFines: 0
    };
    db.installments.push(inst);
    newInstallments.push(inst);
  }

  await syncWithAppsScript('upgradeContract', {
    oldContractId, oldDeviceId: oldContract.deviceId, newContractId,
    newContract, newInstallments
  });

  logAction('ترقية عقد', `ترقية ${oldContract.clientName} من ${oldContract.deviceInfo} إلى ${newDevice.brand} ${newDevice.name} — عقد جديد بإجمالي ${totalToFinance.toLocaleString()} ج.م`);

  document.getElementById('upgrade-contract-modal').remove();
  renderContracts();
  renderInventory();
  renderCollections();
  renderDashboard();
  showToast('✅ تم ترقية العقد بنجاح وفتح عقد جديد', 'success');
  });
};

window.switchTab = function(tabName) {
  // منع أي مستخدم من الانتقال إلى تبويب غير مصرح له به حسب دوره وصلاحياته
  if (currentUser && !isTabAllowedForCurrentUser(tabName)) {
    tabName = currentUser.role === 'COLLECTOR' ? 'collections' : 'dashboard';
  }
  const tabLabels = {
    dashboard: 'لوحة القيادة', clients: 'العملاء والضامنين', 'client-balances': 'أرصدة العملاء',
    inventory: 'المخزون والأجهزة', suppliers: 'الموردون', products: 'الأصناف والمنتجات',
    contracts: 'العقود والمبيعات', collections: 'التحصيلات', treasury: 'الخزينة',
    investors: 'المستثمرون ورأس المال', expenses: 'المصروفات', 'today-reminders': 'تنبيهات اليوم',
    reports: 'التقارير', users: 'إدارة المستخدمين', 'audit-log': 'سجل العمليات', settings: 'إعدادات النظام'
  };
  const headerActivePage = document.getElementById('header-active-page');
  if (headerActivePage) headerActivePage.textContent = tabLabels[tabName] || 'مساحة العمل';
  
  document.querySelectorAll('#sidebar-menu a').forEach(b => {
    if (b.getAttribute('data-tab') === tabName) {
      b.className = 'nav-link nav-link-active flex items-center gap-3 px-4 py-3 rounded-xl font-semibold transition-colors duration-200 active-tab-btn';
    } else {
      b.className = 'nav-link flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-skyDark-800 dark:hover:text-white font-medium transition-colors duration-200';
    }
  });

  document.querySelectorAll('#main-content-tabs > section').forEach(sec => {
    sec.classList.add('hidden');
  });

  const activeSection = document.getElementById(`tab-${tabName}`);
  if (activeSection) {
    activeSection.classList.remove('hidden');
    // إعادة تشغيل أنيميشن الظهور السلس في كل مرة يتفتح فيها التاب
    activeSection.classList.remove('tab-fade-in');
    void activeSection.offsetWidth; // إجبار المتصفح يعيد حساب الأنيميشن من الأول
    activeSection.classList.add('tab-fade-in');
  }

  renderActiveTab(tabName);
  localStorage.setItem('sky_erp_active_tab', tabName);
  
  // Close mobile sidebar after selecting a tab
  closeMobileSidebar();
};

document.querySelectorAll('#sidebar-menu a').forEach(btn => {
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    const activeTab = this.getAttribute('data-tab');
    switchTab(activeTab);
  });
});

// ================= MOBILE SIDEBAR =================
function openMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('sidebar-open');
  if (backdrop) backdrop.classList.add('visible');
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  // منع التمرير على جميع العناصر الأخرى
  const main = document.querySelector('main');
  if (main) main.style.overflow = 'hidden';
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('sidebar-open');
  if (backdrop) backdrop.classList.remove('visible');
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  // استعادة التمرير على العناصر الأخرى
  const main = document.querySelector('main');
  if (main) main.style.overflow = 'auto';
}

window.openMobileSidebar = openMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;

// ================= DARK MODE TOGGLE =================
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeToggleIcon = document.getElementById('theme-toggle-icon');

const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
if (sidebarCollapseBtn) {
  const sidebarCollapsed = localStorage.getItem('sky_erp_sidebar_collapsed') === 'true';
  document.documentElement.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  sidebarCollapseBtn.addEventListener('click', () => {
    const collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sky_erp_sidebar_collapsed', String(collapsed));
  });
}

const headerCurrentDate = document.getElementById('header-current-date');
if (headerCurrentDate) {
  headerCurrentDate.textContent = new Intl.DateTimeFormat('ar-EG', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date());
}

function updateThemeIcon(isDark) {
  if (isDark) {
    themeToggleIcon.className = 'ph ph-sun text-amber-400';
  } else {
    themeToggleIcon.className = 'ph ph-moon';
  }
}

// Check initial theme from localStorage
const storedTheme = localStorage.getItem('sky_erp_theme');
if (storedTheme === 'dark' || (!storedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark');
  updateThemeIcon(true);
} else {
  document.documentElement.classList.remove('dark');
  updateThemeIcon(false);
}

themeToggleBtn.addEventListener('click', () => {
  document.documentElement.classList.toggle('dark');
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('sky_erp_theme', isDark ? 'dark' : 'light');
  updateThemeIcon(isDark);

  // إعادة رسم الرسم البياني بالداشبورد بألوان تناسب الوضع الجديد فوراً،
  // لو التاب المفتوح حالياً هو لوحة القيادة
  const dashboardSection = document.getElementById('tab-dashboard');
  if (dashboardSection && !dashboardSection.classList.contains('hidden') && typeof renderDashboard === 'function') {
    renderDashboard();
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (await customConfirm('هل ترغب في تسجيل الخروج؟')) {
    handleUserLogout();
  }
});

document.getElementById('login-submit-btn').addEventListener('click', performLogin);
document.getElementById('login-password-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') performLogin();
});
// FEATURE: كان زرار Enter شغال بس لو المستخدم واقف في خانة كلمة المرور.
// دلوقتي شغال من خانة اسم المستخدم كمان (بدل ما يضطر يدوس Tab الأول).
document.getElementById('login-username-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') performLogin();
});

// FEATURE: زرار "عين" لإظهار/إخفاء كلمة المرور في شاشة الدخول، لتقليل
// أخطاء الكتابة خصوصاً على الموبايل.
window.togglePasswordVisibility = function (inputId, toggleBtnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(toggleBtnId);
  if (!input || !btn) return;
  const icon = btn.querySelector('i');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  if (icon) {
    icon.classList.toggle('ph-eye', !isHidden);
    icon.classList.toggle('ph-eye-slash', isHidden);
  }
  input.focus();
  // نرجع المؤشر لآخر الكلمة بدل ما يقفز لأول الخانة بعد تغيير النوع
  const len = input.value.length;
  input.setSelectionRange(len, len);
};

// ================= INITIALIZATION =================
// ================= FIX: شبكة أمان عامة ضد فشل الرسم الصامت =================
// السبب الجذري للمشكلة اللي حصلت (عميل بيتحفظ فعلاً لكن مش بيظهر في
// القائمة، والعداد فاضل صفر): أي خطأ برمجي جوه أي دالة renderXxx (زي محاولة
// عمل .toLowerCase() على حقل ناقص في سجل قديم) كان بيوقف الرسم في نص
// الطريق من غير أي رسالة تظهر للمستخدم خالص - الشاشة تفضل فاضية بصمت.
// دلوقتي أي خطأ زي ده هيظهر كتنبيه واضح فوق الشاشة بدل الفشل الصامت، حتى
// لو السبب حقل ناقص في سجل قديم مختلف تماماً عن اللي بتحاول تضيفه دلوقتي.
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error);
  const banner = document.getElementById('global-error-banner');
  if (banner) {
    const textEl = banner.querySelector('span');
    if (textEl) textEl.textContent = `⚠️ حصل خطأ غير متوقع أثناء عرض الشاشة (${event.message}). البيانات غالباً محفوظة بأمان، لكن العرض توقف - جرّب تحدّث الصفحة (F5)، ولو استمرت المشكلة ابعت هذا النص لفريق الدعم.`;
    banner.classList.remove('hidden');
  }
});

initDatabase();
// ملاحظة: لم نعد نستدعي أي دالة "auto login" يدوية تعتمد على localStorage.
// شاشة الدخول تظل معروضة افتراضياً (كما هي في index.html) لحين ورود أول
// حدث firebase-auth-changed من firebase-config.js، والذي يقرر تلقائياً هل
// هناك جلسة Firebase Authentication محفوظة يعاد فتحها أو يجب إظهار شاشة الدخول.
setLoginLoading(true, 'جاري التحقق من الجلسة...');
handleMobileTopbar(); // Initialize mobile topbar visibility

// شبكة أمان: لو لأي سبب (مفيش إنترنت، سكريبت Firebase اتحجب، إلخ) ملحدث
// firebase-auth-changed ما اتطلقش خالص خلال 10 ثواني، نوري شاشة الدخول
// بدل ما نسيب المستخدم واقف على شاشة "جاري التحقق" للأبد.
setTimeout(() => {
  const overlay = document.getElementById('session-check-overlay');
  if (overlay && !overlay.classList.contains('hidden')) {
    console.warn('لم يتم استلام حدث firebase-auth-changed خلال المهلة المحددة. إظهار شاشة الدخول كإجراء احتياطي.');
    showLoginScreen();
    showLoginError('❌ تعذر التحقق من جلسة الدخول. تحقق من اتصال الإنترنت وحاول مرة أخرى.');
  }
}, 10000);

// Custom wrapper to open contract modal and populate dropdowns with latest data
window.openAddContractModal = function() {
  populateDropdowns();
  targetMonthlyManuallySet = false;
  openModal('add-contract-modal');
};

// ================= تهيئة Firebase بعد تسجيل دخول حقيقي =================
// الاستماع لحدث firebase-auth-changed الذي يُطلق من firebase-config.js
// فور أي تغيّر في حالة المصادقة الحقيقية (دخول ناجح / خروج / استعادة جلسة محفوظة)

// تحميل بيانات النظام (مرة واحدة) والاشتراك في التحديثات الفورية بعد تأكيد الدخول
async function startFirebaseSubscription(uid, email) {
  if (!window.FirebaseService || !window.FirebaseService.isAvailable()) {
    showLoginScreen();
    showLoginError('❌ تعذر الاتصال بقاعدة البيانات السحابية.');
    return;
  }

  // تحميل أولي كامل للبيانات (يتضمن ملفات المستخدمين اللازمة لمطابقة الحساب الحالي)
  await loadFromServer();

  // FIX: قبل مطابقة المستخدم، نحاول نضمن وجود مستند userRoles له.
  // هذا يحل مشكلة الأدمن اللي اتعمل يدوياً في Firebase Auth من غير مستند userRoles.
  // الدالة بتستخدم merge:true فما تضرش لو المستند موجود مسبقاً.
  if (uid && window.FirebaseAuthService && window.FirebaseAuthService.ensureUserRoleDoc) {
    // نحاول نجيب الدور من بيانات المستخدم المحملة
    const matchedUser = db.users.find(u => u.authUid === uid) ||
      db.users.find(u => window.FirebaseAuthService.usernameToAuthEmail(u.username) === email);
    if (matchedUser && matchedUser.role) {
      try {
        await window.FirebaseAuthService.ensureUserRoleDoc(uid, matchedUser.role, matchedUser.name);
      } catch (e) {
        console.warn('تعذّر إنشاء userRoles في startFirebaseSubscription:', e);
      }
    }
  }

  // مطابقة الحساب المُسجَّل دخوله حالياً مع ملفه في Firestore وفتح الشاشة الرئيسية
  if (uid) {
    await resolveCurrentUserFromAuth(uid, email);
    // ملاحظة: تم إلغاء التنبيه التلقائي المنبثق هنا نهائياً؛ تنبيهات الأقساط
    // المستحقة اليوم بقت متاحة عند الطلب فقط عبر جرس التنبيهات في الأعلى.
  }

  if (firebaseSubscriptionActive) return; // منع الاشتراك المزدوج في التحديثات الفورية

  // أمان إضافي: لو لأي سبب كان فيه اشتراك سابق لسه شغال (مثلاً بعد خروج
  // ودخول سريع) نقفله الأول قبل ما نفتح واحد جديد، عشان نضمن إن مفيش أكتر
  // من 18 listener شغالين في نفس الوقت أبداً.
  if (typeof firebaseUnsubscribeUpdates === 'function') {
    firebaseUnsubscribeUpdates();
    firebaseUnsubscribeUpdates = null;
  }

  firebaseSubscriptionActive = true;
  console.log("Starting Firebase real-time subscription after real authentication...");

  // الاشتراك في التحديثات الفورية (Real-time) - نخزن دالة إلغاء الاشتراك
  // الراجعة عشان نقدر نقفل كل الـ 18 listener صح وقت الخروج (handleUserLogout)
  firebaseUnsubscribeUpdates = window.FirebaseService.subscribeToUpdates((colName, items) => {
    if (colName === 'settings') {
      if (items) {
        db.settings = { ...db.settings, ...items };
        applyCompanyBranding();
        updateSyncStatusUI();
      }
    } else if (colName === 'users' && (!items || items.length === 0)) {
      // البذر التلقائي إذا كانت قاعدة البيانات فارغة
      console.warn("Firestore 'users' collection is empty. Seeding default data...");
      window.FirebaseService.seedFirebase(defaultSeedData);
    } else if (colName === 'treasuryTransactions' || colName === 'auditLogs' || colName === 'investorSnapshots') {
      // نرتب حسب الوقت (الأحدث أولاً) لأن Firebase مش بيضمن ترتيب معين للنتائج
      db[colName] = sortByTimestampDesc(items || []);
    } else if (colName === 'brands') {
      // تنظيف ذاتي: أي عنصر قديم مش كائن مرتبط بصنف (categoryId) بيتجاهل،
      // لأنه بقايا من نظام قديم قبل ربط الماركات بالأصناف الهرمية.
      db.brands = (items || []).filter(b => typeof b === 'object' && b !== null && b.categoryId);
    } else {
      db[colName] = items || [];
    }

    renderAllTabs();
  });
}

// الاستماع لحدث تغيّر حالة المصادقة الحقيقية القادم من firebase-config.js
window.addEventListener('firebase-auth-changed', async (event) => {
  const { signedIn, uid, email } = event.detail;
  console.log("firebase-auth-changed event received:", event.detail);

  if (signedIn) {
    setLoginLoading(true, 'جاري تحميل بياناتك...');
    await startFirebaseSubscription(uid, email);
  } else {
    // لا توجد جلسة دخول حقيقية (خروج أو أول زيارة أو انتهاء الجلسة من تلقاء
    // نفسها) - أظهر شاشة الدخول. نقفل أي listeners شغالة هنا أيضاً وليس فقط
    // في handleUserLogout، عشان نغطي حالة انتهاء الجلسة تلقائياً (مش بس زرار
    // الخروج اليدوي).
    firebaseSubscriptionActive = false;
    currentUser = null;
    if (typeof firebaseUnsubscribeUpdates === 'function') {
      firebaseUnsubscribeUpdates();
      firebaseUnsubscribeUpdates = null;
    }
    showLoginScreen();
  }
});/**
 * دالة عرض تنبيهات الأقساط المستحقة اليوم
 * أضفها إلى app.js بعد دالة renderExpenses
 */

function renderTodayReminders() {
  const stats = getTodayDueStats();
  
  // Render summary cards
  const summaryContainer = document.getElementById('today-due-summary');
  if (!summaryContainer) return;
  
  summaryContainer.innerHTML = `
    <div class="bg-amber-900 text-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-xl relative overflow-hidden flex flex-col justify-between h-20 sm:h-32">
      <p class="text-[10px] sm:text-xs text-amber-200 font-semibold truncate">الأقساط المستحقة اليوم</p>
      <h4 class="text-base sm:text-3xl font-extrabold mt-1.5 sm:mt-3 text-amber-300 truncate">${stats.totalCount}</h4>
    </div>
    <div class="bg-slate-900 text-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-xl relative overflow-hidden flex flex-col justify-between h-20 sm:h-32">
      <p class="text-[10px] sm:text-xs text-slate-400 font-semibold truncate">الإجمالي المطلوب</p>
      <h4 class="text-base sm:text-3xl font-extrabold mt-1.5 sm:mt-3 text-teal-400 truncate">${stats.totalDueAmount.toLocaleString()} ج.م</h4>
    </div>
    <div class="bg-rose-900 text-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-xl relative overflow-hidden flex flex-col justify-between h-20 sm:h-32">
      <p class="text-[10px] sm:text-xs text-rose-200 font-semibold truncate">الأقساط المتأخرة</p>
      <h4 class="text-base sm:text-3xl font-extrabold mt-1.5 sm:mt-3 text-rose-300 truncate">${stats.overdueCount}</h4>
    </div>
    <div class="bg-emerald-900 text-white rounded-xl sm:rounded-2xl p-3 sm:p-6 shadow-xl relative overflow-hidden flex flex-col justify-between h-20 sm:h-32">
      <p class="text-[10px] sm:text-xs text-emerald-200 font-semibold truncate">إجمالي المتأخرات</p>
      <h4 class="text-base sm:text-3xl font-extrabold mt-1.5 sm:mt-3 text-emerald-300 truncate">${stats.overdueDueAmount.toLocaleString()} ج.م</h4>
    </div>
  `;
  
  // Render installments table
  const tbody = document.getElementById('today-installments-body');
  // FIX: حماية عامة - لو العنصر مش موجود لأي سبب (نسخة قديمة/تعارض تحميل)،
  // نوقف بأمان بدل ما نكسر الشاشة كلها بخطأ 'innerHTML of null'.
  if (!tbody) return;
  const emptyState = document.getElementById('today-empty-state');
  
  if (!tbody) return;
  
  if (stats.installments.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
  } else {
    if (emptyState) emptyState.classList.add('hidden');
    tbody.innerHTML = stats.installments.map(inst => {
      const status = getInstallmentOverdueStatus(inst);
      const statusText = status.overdueDays > 0 ? `⚠️ متأخر ${status.overdueDays} يوم` : '📅 يستحق اليوم';
      const statusColor = status.overdueDays > 0 ? 'text-rose-600' : 'text-sky-600';
      
      return `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="p-4 font-bold text-slate-800">${escapeHTML(inst.clientName)}</td>
          <td class="p-4 font-mono text-slate-600">${escapeHTML(inst.clientPhone)}</td>
          <td class="p-4 font-bold font-mono text-teal-600">${inst.amount.toLocaleString()} ج.م</td>
          <td class="p-4 text-sm ${statusColor}">${statusText}</td>
          <td class="p-4 text-center">
            <div class="inline-flex gap-1">
              <button onclick="openWhatsappModal('${inst.id}', 'reminder')" class="px-2 py-1 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded text-xs font-bold transition-all" title="إرسال تذكير">
                <i class="ph ph-bell"></i>
              </button>
              <button onclick="collectInstallmentBtn('${inst.id}')" class="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-xs font-bold transition-all" title="تحصيل">
                <i class="ph ph-check-square"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
  
}
