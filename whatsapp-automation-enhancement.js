/**
 * تحسينات نظام الربط الآلي مع واتساب
 * يركز على:
 * 1. تنبيهات صباحية بالأقساط المستحقة اليوم
 * 2. طابور إرسال سريع لكل العملاء (رسالة جاهزة لكل عميل بضغطة واحدة، بدون الحاجة تكتب الرسالة من الأول لكل واحد)
 * 3. جدولة التنبيهات التلقائية
 */

// ================= حساب الأقساط المستحقة اليوم =================
function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * الحصول على الأقساط المستحقة اليوم وفق توقيت جهاز المستخدم المحلي.
 */
function getTodayDueInstallments() {
  const today = getLocalDateKey();
  
  const todayInstallments = db.installments.filter(inst => {
    return (inst.dueDate || '').substring(0, 10) === today && inst.status !== 'paid';
  });
  
  return todayInstallments;
}

/**
 * حساب إحصائيات الأقساط المستحقة اليوم
 */
function getTodayDueStats() {
  const todayInstallments = getTodayDueInstallments();
  const today = getLocalDateKey();
  const overdueInstallments = db.installments.filter(inst => {
    const dueDate = (inst.dueDate || '').substring(0, 10);
    return inst.status !== 'paid' && dueDate && dueDate < today;
  });
  
  const totalDueAmount = todayInstallments.reduce((sum, inst) => sum + safeNum(inst.amount), 0);
  const overdueDueAmount = overdueInstallments.reduce((sum, inst) => {
    const status = getInstallmentOverdueStatus(inst);
    return sum + status.totalDue;
  }, 0);
  
  return {
    totalCount: todayInstallments.length,
    totalDueAmount,
    overdueCount: overdueInstallments.length,
    overdueDueAmount,
    pendingCount: todayInstallments.length,
    installments: [...overdueInstallments, ...todayInstallments],
    todayInstallments
  };
}

/**
 * الأقساط اللي هتستحق قريباً (خلال N يوم جايين، مش مستحقة النهاردة ولا متأخرة)
 * الهدف: تذكير العميل قبل ما يتأخر أصلاً، بدل التنبيه يوم الاستحقاق بس.
 */
function getUpcomingDueInstallments(daysAhead = 3) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return db.installments.filter(inst => {
    if (inst.status === 'paid') return false;
    const due = new Date(inst.dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
    return diffDays > 0 && diffDays <= daysAhead;
  });
}

function getUpcomingDueStats(daysAhead = 3) {
  const upcoming = getUpcomingDueInstallments(daysAhead);
  const totalDueAmount = upcoming.reduce((sum, inst) => sum + safeNum(inst.amount), 0);
  return { totalCount: upcoming.length, totalDueAmount, installments: upcoming, daysAhead };
}

/**
 * إرسال تذكيرات استباقية للأقساط اللي هتستحق قريباً (قبل ما تتأخر أصلاً)
 */
window.sendUpcomingRemindersInBulk = async function() {
  const stats = getUpcomingDueStats(3);
  if (stats.totalCount === 0) {
    alert('لا توجد أقساط مستحقة خلال الأيام الثلاثة القادمة.');
    return;
  }
  const ids = stats.installments.map(i => i.id);
  const prepared = prepareBulkWhatsappMessages(ids, 'reminder');

  if (!prepared.success) {
    alert(prepared.message);
    return;
  }

  if (!(await customConfirm(`فيه ${prepared.totalCount} تذكير استباقي (قبل الاستحقاق) جاهز. هيتفتح طابور إرسال تقدر تراجع فيه كل رسالة وتفتح واتساب لها بنفسك واحدة واحدة. تكمل؟`))) {
    return;
  }

  window.openWhatsappSendQueue(prepared);
};


/**
 * إنشاء تنبيه صباحي بالأقساط المستحقة اليوم
 */
function generateTodayDueReminder() {
  const stats = getTodayDueStats();
  
  if (stats.totalCount === 0) {
    return {
      hasDue: false,
      message: 'لا توجد أقساط مستحقة اليوم'
    };
  }
  
  const today = new Date().toLocaleDateString('ar-EG');
  const message = `
📢 تنبيه صباحي - الأقساط المستحقة اليوم ${today}

📊 الإحصائيات:
• عدد الأقساط المستحقة: ${stats.totalCount}
• الإجمالي المطلوب: ${stats.totalDueAmount.toLocaleString()} ج.م
• منها متأخرة: ${stats.overdueCount}
• قيد الاستحقاق: ${stats.pendingCount}

👥 تفاصيل العملاء:
${stats.installments.map((inst, idx) => {
  const status = getInstallmentOverdueStatus(inst);
  const statusText = status.overdueDays > 0 ? `⚠️ متأخر ${status.overdueDays} يوم` : '📅 يستحق اليوم';
  return `${idx + 1}. ${inst.clientName} - ${inst.amount.toLocaleString()} ج.م ${statusText}`;
}).join('\n')}

💡 استخدم زر "فتح طابور الإرسال" لتجهيز وفتح رسائل واتساب لكل العملاء بسرعة (رسالة برسالة، بضغطة واحدة لكل عميل).
  `.trim();
  
  return {
    hasDue: true,
    stats,
    message,
    timestamp: new Date().toLocaleString('ar-EG')
  };
}

// ================= إرسال جماعي محسّن =================
/**
 * إعداد الرسائل الجماعية للإرسال بضغطة زر واحدة
 */
function prepareBulkWhatsappMessages(installmentIds = null, messageType = 'reminder') {
  let targetInstallments;
  
  if (installmentIds) {
    // إرسال لأقساط محددة
    targetInstallments = db.installments.filter(inst => 
      installmentIds.includes(inst.id) && inst.status !== 'paid'
    );
  } else {
    // إرسال لأقساط اليوم
    targetInstallments = getTodayDueInstallments();
  }
  
  if (targetInstallments.length === 0) {
    return {
      success: false,
      message: 'لا توجد أقساط للإرسال'
    };
  }
  
  const companyName = db.settings.companyName || 'شركة SKY';
  const templates = db.settings.templates || {};
  
  let templateText;
  if (messageType === 'reminder') {
    templateText = templates.reminder || `مرحباً {{الاسم}}، نود تذكيركم بموعد استحقاق القسط الشهري لعقدكم رقم {{العقد}} لدى {{اسم_الشركة}}. المبلغ المطلوب: {{القسط}} ج.م. تاريخ الاستحقاق: {{التاريخ}}.`;
  } else if (messageType === 'warning') {
    templateText = templates.warning || `تنبيه هام: تجاوز تاريخ استحقاق قسطكم لعقد رقم {{العقد}}. المبلغ المطلوب: {{القسط}} ج.م + غرامة {{الغرامة}} ج.م.`;
  } else if (messageType === 'receipt') {
    templateText = templates.receipt || `تم استلام دفعتكم بنجاح! شكراً على سداد القسط الشهري لعقدكم رقم {{العقد}}.`;
  }
  
  const messages = targetInstallments.map(inst => {
    const status = getInstallmentOverdueStatus(inst);
    
    const resolvedMsg = templateText
      .replace(/{{الاسم}}/g, inst.clientName)
      .replace(/{{القسط}}/g, inst.amount.toLocaleString())
      .replace(/{{التاريخ}}/g, inst.dueDate)
      .replace(/{{العقد}}/g, inst.contractId.replace('con-', ''))
      .replace(/{{الغرامة}}/g, status.fine.toLocaleString())
      .replace(/{{المطلوب}}/g, status.totalDue.toLocaleString())
      .replace(/{{اسم_الشركة}}/g, companyName);
    
    return {
      installmentId: inst.id,
      clientName: inst.clientName,
      clientPhone: inst.clientPhone,
      normalizedPhone: normalizeWhatsappPhone(inst.clientPhone),
      amount: inst.amount,
      dueDate: inst.dueDate,
      message: resolvedMsg,
      status: 'pending' // pending, sent, failed
    };
  });
  
  return {
    success: true,
    totalCount: messages.length,
    messages,
    messageType,
    preparedAt: new Date().toLocaleString('ar-EG')
  };
}

// ================= IMPROVEMENT #2: إرسال جماعي حقيقي وصريح =================
// المشكلة القديمة: الكود كان بيفتح نافذة wa.me منفصلة لكل عميل جوه حلقة
// for، بفاصل نص ثانية بس بينهم. المتصفحات (كروم/فايرفوكس/سفاري) بتمنع أي
// نافذة/تاب جديد بيتفتح برمجياً من غير "لمسة مستخدم مباشرة" لكل نافذة على
// حدة - فكانت بتفتح أول رسالة أو اتنين بس، والباقي بيتحجب صامتاً كـ Popup،
// بينما الكود كان بيسجلهم "تم الإرسال بنجاح" في السجل رغم إن التاب أصلاً
// ما اتفتحش. تسمية "إرسال جماعي تلقائي" كانت مضللة لنفس السبب: واتساب
// نفسه (wa.me) مبيسمحش بإرسال تلقائي بدون تفاعل بشري داخل واتساب نفسه -
// أقصى حاجة ممكنة من المتصفح هي تجهيز الرسالة وفتحها جاهزة للإرسال.
//
// الحل الصادق: طابور إرسال (Send Queue) بواجهة واضحة - رسالة واحدة في
// الشاشة في كل مرة، وزرار "فتح واتساب لهذا العميل" بيبقى ضغطة مستخدم حقيقية
// (User Gesture) لكل رسالة على حدة، فبتفتح 100% من غير ما يحجبها المتصفح.
// بعد الفتح، المستخدم يدوس "التالي" يدوياً بنفسه (تأكيداً إنه فعلاً بعت
// الرسالة من جوه واتساب قبل ما ينتقل)، فمفيش أي ادّعاء بإرسال ما حصلش فعلاً.
window.openWhatsappSendQueue = function (prepared, onDone) {
  if (!prepared || !prepared.success || prepared.totalCount === 0) return;

  const validMessages = prepared.messages.filter(m => m.normalizedPhone);
  const invalidCount = prepared.messages.length - validMessages.length;

  document.getElementById('wa-send-queue-modal')?.remove();
  let currentIndex = 0;
  let sentCount = 0;
  let skippedCount = 0;
  const log = [];

  const modal = document.createElement('div');
  modal.id = 'wa-send-queue-modal';
  modal.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-4';

  function render() {
    if (currentIndex >= validMessages.length) {
      modal.innerHTML = `
        <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 text-center">
          <i class="ph ph-check-circle text-4xl text-emerald-600 mb-2"></i>
          <h3 class="font-bold text-slate-800 text-lg mb-1">انتهى طابور الإرسال</h3>
          <p class="text-sm text-slate-500 mb-4">تم فتح واتساب لـ ${sentCount} عميل${skippedCount > 0 ? ` — تم تخطي ${skippedCount}` : ''}${invalidCount > 0 ? ` — ${invalidCount} برقم هاتف غير صحيح لم يُفتح لهم` : ''}.</p>
          <button id="wa-queue-close" class="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold text-sm">تم</button>
        </div>
      `;
      modal.querySelector('#wa-queue-close').addEventListener('click', () => {
        modal.remove();
        logAction('إرسال جماعي واتساب', `فتح واتساب يدوياً لـ ${sentCount} عميل (تخطي: ${skippedCount}, أرقام غير صحيحة: ${invalidCount})`);
        if (typeof onDone === 'function') onDone({ sentCount, skippedCount, invalidCount, log });
      });
      return;
    }

    const msg = validMessages[currentIndex];
    modal.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-bold text-slate-800 text-lg">طابور إرسال واتساب</h3>
          <span class="text-xs font-semibold text-slate-400">${currentIndex + 1} / ${validMessages.length}</span>
        </div>
        <div class="w-full bg-slate-200 rounded-full h-1.5 mb-4">
          <div class="bg-teal-600 h-1.5 rounded-full transition-all" style="width:${Math.round((currentIndex / validMessages.length) * 100)}%"></div>
        </div>
        <div class="bg-slate-50 rounded-xl p-4 mb-4">
          <p class="font-bold text-slate-800 text-sm mb-1">${escapeHTML(msg.clientName)}</p>
          <p class="text-xs text-slate-400 mb-2 font-mono">${escapeHTML(msg.clientPhone)}</p>
          <p class="text-xs text-slate-600 whitespace-pre-line leading-relaxed">${escapeHTML(msg.message)}</p>
        </div>
        <p class="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 mb-4">
          <i class="ph ph-info mr-1"></i> هيتفتح واتساب في تاب جديد ومعاه الرسالة جاهزة، بس لازم تدوس زرار "إرسال" جوه واتساب نفسه بيدك - المتصفح ولا النظام مقدرش يبعتها نيابة عنك.
        </p>
        <div class="grid grid-cols-2 gap-2">
          <button id="wa-queue-skip" class="py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-semibold text-sm">تخطي هذا العميل</button>
          <button id="wa-queue-send" class="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm flex items-center justify-center gap-1.5"><i class="ph ph-whatsapp-logo"></i> فتح واتساب لهذا العميل</button>
        </div>
        <button id="wa-queue-stop" class="w-full mt-2 py-1.5 text-xs text-slate-400 hover:text-slate-600">إيقاف الطابور وإغلاق</button>
      </div>
    `;

    modal.querySelector('#wa-queue-skip').addEventListener('click', () => {
      skippedCount++;
      log.push({ ...msg, status: 'skipped' });
      currentIndex++;
      render();
    });
    modal.querySelector('#wa-queue-send').addEventListener('click', () => {
      // لمسة مستخدم حقيقية ومباشرة هنا (event handler لضغطة زرار) - عشان كده
      // المتصفح مش هيحجب النافذة دي أبداً، عكس النداء القديم جوه for loop.
      const waUrl = `https://wa.me/${msg.normalizedPhone}?text=${encodeURIComponent(msg.message)}`;
      window.open(waUrl, '_blank');
      sentCount++;
      log.push({ ...msg, status: 'sent', sentAt: new Date().toLocaleString('ar-EG') });
      currentIndex++;
      render();
    });
    modal.querySelector('#wa-queue-stop').addEventListener('click', () => {
      modal.remove();
      logAction('إرسال جماعي واتساب', `تم إيقاف طابور الإرسال يدوياً بعد فتح واتساب لـ ${sentCount} عميل من ${validMessages.length}`);
      if (typeof onDone === 'function') onDone({ sentCount, skippedCount, invalidCount, log, stoppedEarly: true });
    });
  }

  render();
  document.body.appendChild(modal);
};

// ================= واجهة المستخدم =================
/**
 * عرض لوحة التنبيهات الصباحية
 */
window.showTodayDueRemindersPanel = function() {
  const reminder = generateTodayDueReminder();
  
  const panel = document.createElement('div');
  panel.className = 'fixed bottom-4 right-4 bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md z-40 p-6';
  panel.innerHTML = `
    <div class="flex items-start justify-between mb-4">
      <div class="flex items-center gap-2">
        <div class="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
          <i class="ph ph-bell-ringing text-amber-600 text-lg"></i>
        </div>
        <h3 class="font-bold text-slate-800">تنبيهات اليوم</h3>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" class="text-slate-400 hover:text-slate-600">
        <i class="ph ph-x text-lg"></i>
      </button>
    </div>
    
    ${reminder.hasDue ? `
      <div class="space-y-3">
        <div class="bg-amber-50 border border-amber-100 rounded-lg p-3">
          <p class="text-sm font-semibold text-amber-900">الأقساط المستحقة اليوم</p>
          <p class="text-2xl font-bold text-amber-600 mt-1">${reminder.stats.totalCount}</p>
          <p class="text-xs text-amber-700 mt-1">إجمالي المبلغ: ${reminder.stats.totalDueAmount.toLocaleString()} ج.م</p>
        </div>
        
        <div class="grid grid-cols-2 gap-2">
          <div class="bg-rose-50 border border-rose-100 rounded-lg p-2 text-center">
            <p class="text-xs text-rose-600 font-semibold">متأخرة</p>
            <p class="text-lg font-bold text-rose-600">${reminder.stats.overdueCount}</p>
          </div>
          <div class="bg-sky-50 border border-sky-100 rounded-lg p-2 text-center">
            <p class="text-xs text-sky-600 font-semibold">قيد الاستحقاق</p>
            <p class="text-lg font-bold text-sky-600">${reminder.stats.pendingCount}</p>
          </div>
        </div>
        
        <button onclick="sendTodayDueRemindersInBulk()" class="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2">
          <i class="ph ph-paper-plane"></i>
          <span>فتح طابور الإرسال</span>
        </button>
        
        <button onclick="viewTodayDueDetails()" class="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm transition-all">
          عرض التفاصيل
        </button>
      </div>
    ` : `
      <div class="bg-emerald-50 border border-emerald-100 rounded-lg p-4 text-center">
        <i class="ph ph-check-circle text-3xl text-emerald-600 mb-2"></i>
        <p class="text-emerald-700 font-semibold">لا توجد أقساط مستحقة اليوم</p>
        <p class="text-xs text-emerald-600 mt-1">كل شيء على ما يرام ✨</p>
      </div>
    `}
  `;
  
  document.body.appendChild(panel);
};

/**
 * إرسال تنبيهات اليوم بضغطة زر واحدة
 */
window.sendTodayDueRemindersInBulk = async function() {
  const prepared = prepareBulkWhatsappMessages(null, 'reminder');
  
  if (!prepared.success) {
    alert(prepared.message);
    return;
  }
  
  if (!(await customConfirm(`فيه ${prepared.totalCount} تنبيه واتساب جاهز للعملاء المستحقين اليوم. هيتفتح طابور إرسال تقدر تراجع فيه كل رسالة وتفتح واتساب لها بنفسك واحدة واحدة. تكمل؟`))) {
    return;
  }
  
  // IMPROVEMENT #2: بدل شاشة تقدم وهمية كانت بتدّعي "تم الإرسال" لرسائل
  // اتحجبت فعلياً كـ Popup من غير ما تتفتح، دلوقتي بنستخدم طابور إرسال
  // حقيقي بلمسة مستخدم مباشرة لكل رسالة (شوف تعليق openWhatsappSendQueue).
  window.openWhatsappSendQueue(prepared);
};

/**
 * عرض تفاصيل الأقساط المستحقة اليوم
 */
window.viewTodayDueDetails = function() {
  const stats = getTodayDueStats();
  
  if (stats.totalCount === 0) {
    alert('لا توجد أقساط مستحقة اليوم');
    return;
  }
  
  const today = new Date().toLocaleDateString('ar-EG');
  
  let rows = stats.installments.map(inst => {
    const status = getInstallmentOverdueStatus(inst);
    const statusText = status.overdueDays > 0 ? `⚠️ متأخر ${status.overdueDays} يوم` : '📅 يستحق اليوم';
    
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50">
        <td class="p-3 font-bold text-slate-800">${escapeHTML(inst.clientName)}</td>
        <td class="p-3 text-slate-600">${escapeHTML(inst.clientPhone)}</td>
        <td class="p-3 font-mono font-bold text-teal-600">${inst.amount.toLocaleString()} ج.م</td>
        <td class="p-3 text-xs">${statusText}</td>
        <td class="p-3 text-center">
          <button onclick="openWhatsappModal('${inst.id}', 'reminder')" class="px-2 py-1 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded text-xs font-bold">
            <i class="ph ph-paper-plane"></i> إرسال
          </button>
        </td>
      </tr>
    `;
  }).join('');
  
  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#0d9488;">الأقساط المستحقة اليوم</div>
        <div style="font-size:0.75rem; color:#64748b;">التاريخ: ${today}</div>
      </div>
    </div>
    
    <div class="print-doc-title">تفاصيل الأقساط المستحقة اليوم</div>
    
    <div style="margin-top:14px; padding:10px 12px; background:#ecfdf5; border-radius:8px; display:flex; justify-content:space-around; text-align:center; font-size:0.85rem;">
      <div>
        <div style="color:#64748b; font-size:0.7rem;">عدد الأقساط</div>
        <strong>${stats.totalCount}</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">الإجمالي المطلوب</div>
        <strong style="color:#059669;">${stats.totalDueAmount.toLocaleString()} ج.م</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">منها متأخرة</div>
        <strong style="color:#e11d48;">${stats.overdueCount}</strong>
      </div>
    </div>
    
    <div style="margin-top:18px;">
      <table class="print-doc-table" style="width:100%;">
        <thead>
          <tr style="background:#f1f5f9; font-weight:bold;">
            <th style="padding:8px; text-align:right;">اسم العميل</th>
            <th style="padding:8px; text-align:center;">رقم الهاتف</th>
            <th style="padding:8px; text-align:left;">المبلغ</th>
            <th style="padding:8px; text-align:left;">الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${stats.installments.map(inst => {
            const status = getInstallmentOverdueStatus(inst);
            const statusText = status.overdueDays > 0 ? `متأخر ${status.overdueDays} يوم` : 'يستحق اليوم';
            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:8px; text-align:right; font-weight:bold;">${escapeHTML(inst.clientName)}</td>
                <td style="padding:8px; text-align:center; font-family:monospace;">${escapeHTML(inst.clientPhone)}</td>
                <td style="padding:8px; text-align:left; font-weight:bold; color:#0d9488;">${inst.amount.toLocaleString()} ج.م</td>
                <td style="padding:8px; text-align:left; font-size:0.85rem;">${statusText}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    
    <div class="print-doc-footer">تم إصدار هذا التقرير في ${today}</div>
  `;
  
  printHTML(html);
  logAction('عرض تفاصيل اليوم', `عرض تفاصيل الأقساط المستحقة اليوم (${stats.totalCount} قسط)`);
};

// ================= جدولة التنبيهات التلقائية =================
/**
 * تفعيل التنبيهات الصباحية التلقائية
 * (يتم استدعاؤها عند فتح الصفحة أو تحديثها)
 */
function initializeDailyReminders() {
  // التحقق من آخر مرة تم فيها عرض التنبيه اليوم
  const lastReminderDate = localStorage.getItem('lastDailyReminderDate');
  const today = getLocalDateKey();
  
  if (lastReminderDate !== today) {
    // عرض التنبيه الصباحي
    setTimeout(() => {
      showTodayDueRemindersPanel();
      localStorage.setItem('lastDailyReminderDate', today);
    }, 1000);
  }
}

// ملاحظة: تم إلغاء الاستدعاء التلقائي هنا لمنع ظهور التنبيه في صفحة الدخول.
// يتم الآن استدعاء initializeDailyReminders برمجياً من داخل app.js فقط بعد نجاح تسجيل الدخول.
