/**
 * تحسينات نظام تقارير الأرباح المستثمرين
 * يركز على الأرباح المحصلة فعلياً (من الأقساط المسددة فقط)
 * 
 * الميزات الجديدة:
 * 1. حساب الأرباح المحصلة فعلياً بناءً على الأقساط المسددة
 * 2. توزيع الأرباح بين المستثمرين حسب نسبة مساهمتهم
 * 3. كشف حساب مستثمر يوضح الأرباح المحصلة
 */

// ================= حساب الأرباح المحصلة فعلياً =================
/**
 * حساب صافي الأرباح المحصلة فعلياً من الأقساط المسددة فقط
 * (بدون الأقساط المعلقة أو الأصول الأخرى)
 */
function computeActualCollectedProfit() {
  // 1. حساب إجمالي الأقساط المسددة فعلياً
  const paidInstallments = db.installments.filter(inst => inst.status === 'paid');
  const totalCollected = paidInstallments.reduce((sum, inst) => sum + safeNum(inst.paidAmount), 0);
  
  // 2. حساب إجمالي المصروفات التشغيلية
  const totalExpenses = (db.expenses || []).reduce((sum, exp) => sum + safeNum(exp.amount), 0);
  
  // 3. حساب الأرباح المحصلة الفعلية = المحصل - المصروفات
  const actualProfit = totalCollected - totalExpenses;
  
  return {
    totalCollected,
    totalExpenses,
    actualProfit,
    paidInstallmentsCount: paidInstallments.length
  };
}

/**
 * توزيع الأرباح المحصلة فعلياً على المستثمرين
 * بناءً على نسبة مساهمتهم (رأس المال)
 */
function distributeActualProfitToInvestors() {
  const profitData = computeActualCollectedProfit();
  const investors = db.investors || [];
  
  if (investors.length === 0 || profitData.actualProfit <= 0) {
    return {
      profitData,
      distribution: [],
      totalDistributed: 0
    };
  }
  
  // حساب إجمالي رأس المال
  const totalCapital = investors.reduce((sum, inv) => sum + safeNum(inv.capitalAmount), 0);
  
  if (totalCapital <= 0) {
    return {
      profitData,
      distribution: [],
      totalDistributed: 0
    };
  }
  
  // توزيع الأرباح بنسبة رأس المال
  const distribution = investors.map(inv => {
    const capitalRatio = (inv.capitalAmount || 0) / totalCapital;
    const profitShare = profitData.actualProfit * capitalRatio;
    const alreadyWithdrawn = inv.totalWithdrawn || 0;
    const remainingDue = Math.max(0, profitShare - alreadyWithdrawn);
    
    return {
      investorId: inv.id,
      investorName: inv.name,
      capitalAmount: inv.capitalAmount || 0,
      capitalRatio: (capitalRatio * 100).toFixed(2),
      totalProfitShare: profitShare,
      alreadyWithdrawn,
      remainingDue,
      joinDate: inv.joinDate,
      notes: inv.notes
    };
  });
  
  const totalDistributed = distribution.reduce((sum, d) => sum + safeNum(d.totalProfitShare), 0);
  
  return {
    profitData,
    distribution,
    totalDistributed,
    averageProfitPerInvestor: distribution.length > 0 ? totalDistributed / distribution.length : 0
  };
}

/**
 * كشف حساب مستثمر يوضح الأرباح المحصلة فعلياً
 */
function generateInvestorCollectedProfitStatement(investorId) {
  const investor = db.investors.find(i => i.id === investorId);
  if (!investor) return null;
  
  const profitDistribution = distributeActualProfitToInvestors();
  const investorData = profitDistribution.distribution.find(d => d.investorId === investorId);
  
  if (!investorData) return null;
  
  // جمع الأقساط المسددة من عملاء هذا المستثمر (إن وجدوا)
  // ملاحظة: النظام الحالي لا يربط العملاء بالمستثمرين مباشرة، لكن يمكن عرض الإحصائيات العامة
  const paidInstallments = db.installments.filter(inst => inst.status === 'paid');
  
  return {
    investor,
    profitData: profitDistribution.profitData,
    investorShare: investorData,
    paidInstallmentsCount: paidInstallments.length,
    statementDate: new Date().toLocaleString('ar-EG'),
    
    // تفاصيل إضافية
    summary: {
      totalCapitalInvested: investorData.capitalAmount,
      percentageOfTotalCapital: investorData.capitalRatio,
      shareOfCollectedProfit: investorData.totalProfitShare,
      alreadyWithdrawn: investorData.alreadyWithdrawn,
      remainingDue: investorData.remainingDue,
      
      // معلومات عن الأداء
      totalCompanyCollected: profitDistribution.profitData.totalCollected,
      totalCompanyExpenses: profitDistribution.profitData.totalExpenses,
      netCompanyProfit: profitDistribution.profitData.actualProfit
    }
  };
}

/**
 * تقرير مقارن: الأرباح المحصلة vs الأرباح الإجمالية
 */
function generateProfitComparisonReport() {
  const actualProfit = computeActualCollectedProfit();
  const stats = computeInvestorFinancials(); // الدالة الموجودة في app.js
  
  return {
    period: {
      start: stats.periodStart,
      end: stats.periodEnd
    },
    actualCollected: {
      totalCollected: actualProfit.totalCollected,
      totalExpenses: actualProfit.totalExpenses,
      netProfit: actualProfit.actualProfit,
      paidInstallmentsCount: actualProfit.paidInstallmentsCount
    },
    projectedTotal: {
      totalAssets: stats.totalAssets,
      totalCapital: stats.totalCapital,
      netProfit: stats.netProfit,
      totalOutstandingInstallments: stats.outstandingInstallments
    },
    comparison: {
      collectionRate: stats.totalAssets > 0 ? (actualProfit.totalCollected / stats.totalAssets * 100).toFixed(2) : 0,
      profitMargin: actualProfit.totalCollected > 0 ? (actualProfit.actualProfit / actualProfit.totalCollected * 100).toFixed(2) : 0,
      remainingToCollect: Math.max(0, stats.outstandingInstallments)
    }
  };
}

// ================= دوال الطباعة والعرض =================
/**
 * طباعة كشف حساب مستثمر مع الأرباح المحصلة فعلياً
 */
window.printInvestorCollectedProfitStatement = function(investorId) {
  const statement = generateInvestorCollectedProfitStatement(investorId);
  if (!statement) {
    alert('لم يتم العثور على بيانات المستثمر');
    return;
  }
  
  const companyName = db.settings.companyName || 'شركة SKY';
  const fmt = (n) => Math.round(n).toLocaleString();
  
  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#0d9488;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">نظام إدارة الأقساط والخزينة</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>تاريخ الإصدار:</strong> ${statement.statementDate}</div>
        <div><strong>نوع الكشف:</strong> أرباح محصلة فعلياً</div>
      </div>
    </div>
    
    <div class="print-doc-title">كشف حساب مستثمر - الأرباح المحصلة فعلياً</div>
    
    <div class="print-doc-row"><span>اسم المستثمر</span><strong>${escapeHTML(statement.investor.name)}</strong></div>
    <div class="print-doc-row"><span>تاريخ الانضمام</span><strong>${escapeHTML(statement.investor.joinDate) || '—'}</strong></div>
    <div class="print-doc-row"><span>رقم المستثمر</span><strong>${escapeHTML(statement.investor.id)}</strong></div>
    
    <div style="margin-top:14px; padding:10px 12px; background:#ecfdf5; border-radius:8px; display:flex; justify-content:space-around; text-align:center; font-size:0.85rem;">
      <div>
        <div style="color:#64748b; font-size:0.7rem;">رأس المال المستثمَر</div>
        <strong>${fmt(statement.investorShare.capitalAmount)} ج.م</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">نسبة المساهمة</div>
        <strong>${statement.investorShare.capitalRatio}%</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">نصيبه من الأرباح المحصلة</div>
        <strong style="color:#059669;">${fmt(statement.investorShare.totalProfitShare)} ج.م</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">المسحوب فعلياً</div>
        <strong style="color:#d97706;">${fmt(statement.investorShare.alreadyWithdrawn)} ج.م</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">المتبقي له</div>
        <strong style="color:${statement.investorShare.remainingDue >= 0 ? '#059669' : '#e11d48'};">${fmt(statement.investorShare.remainingDue)} ج.م</strong>
      </div>
    </div>
    
    <div style="margin-top:18px; padding:12px; background:#f0f9ff; border-radius:8px; border-left:4px solid #0284c7;">
      <strong style="font-size:0.9rem;">ملخص الأداء المالي للشركة</strong>
      <table class="print-doc-table" style="margin-top:8px;">
        <tr>
          <td style="text-align:right; padding:6px;">إجمالي المحصل من الأقساط</td>
          <td style="text-align:left; font-weight:bold;">${fmt(statement.summary.totalCompanyCollected)} ج.م</td>
        </tr>
        <tr>
          <td style="text-align:right; padding:6px;">إجمالي المصروفات التشغيلية</td>
          <td style="text-align:left; font-weight:bold;">${fmt(statement.summary.totalCompanyExpenses)} ج.م</td>
        </tr>
        <tr style="border-top:2px solid #0284c7;">
          <td style="text-align:right; padding:6px; font-weight:bold;">صافي الأرباح المحصلة</td>
          <td style="text-align:left; font-weight:bold; color:#059669;">${fmt(statement.summary.netCompanyProfit)} ج.م</td>
        </tr>
      </table>
    </div>
    
    <div style="margin-top:18px; padding:12px; background:#fef3c7; border-radius:8px; border-left:4px solid #f59e0b; font-size:0.85rem;">
      <strong>ملاحظات مهمة:</strong>
      <ul style="margin:8px 0 0 20px; padding:0;">
        <li>هذا الكشف يعكس الأرباح المحصلة فعلياً من الأقساط المسددة فقط</li>
        <li>لا يشمل الأقساط المعلقة أو الأصول غير السائلة</li>
        <li>نصيب المستثمر محسوب بناءً على نسبة رأس ماله من إجمالي رأس المال</li>
        <li>المبالغ المسحوبة سابقاً تم خصمها من الحساب</li>
      </ul>
    </div>
    
    <div class="print-doc-signatures">
      <div>توقيع مسؤول الحسابات: ______________</div>
      <div>توقيع المستثمر: ______________</div>
    </div>
    
    <div class="print-doc-footer">تم إصدار هذا الكشف إلكترونياً من نظام ${escapeHTML(companyName)} بتاريخ ${statement.statementDate}</div>
  `;
  
  printHTML(html);
  logAction('طباعة كشف أرباح محصلة', `طباعة كشف الأرباح المحصلة فعلياً للمستثمر ${statement.investor.name}`);
};

/**
 * عرض تقرير توزيع الأرباح المحصلة لجميع المستثمرين
 */
window.viewProfitDistributionReport = function() {
  const report = distributeActualProfitToInvestors();
  
  if (!report.distribution || report.distribution.length === 0) {
    alert('لا توجد بيانات مستثمرين لعرض التقرير');
    return;
  }
  
  const companyName = db.settings.companyName || 'شركة SKY';
  const fmt = (n) => Math.round(n).toLocaleString();
  
  let rows = report.distribution.map(d => `
    <tr>
      <td style="padding:8px; text-align:right;">${escapeHTML(d.investorName)}</td>
      <td style="padding:8px; text-align:center;">${d.capitalRatio}%</td>
      <td style="padding:8px; text-align:left; font-weight:bold;">${fmt(d.capitalAmount)} ج.م</td>
      <td style="padding:8px; text-align:left; font-weight:bold; color:#059669;">${fmt(d.totalProfitShare)} ج.م</td>
      <td style="padding:8px; text-align:left;">${fmt(d.alreadyWithdrawn)} ج.م</td>
      <td style="padding:8px; text-align:left; font-weight:bold; color:#0d9488;">${fmt(d.remainingDue)} ج.م</td>
    </tr>
  `).join('');
  
  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#0d9488;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">تقرير توزيع الأرباح المحصلة فعلياً</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    
    <div class="print-doc-title">تقرير توزيع الأرباح المحصلة بين المستثمرين</div>
    
    <div style="margin-top:14px; padding:10px 12px; background:#ecfdf5; border-radius:8px; display:flex; justify-content:space-around; text-align:center; font-size:0.85rem;">
      <div>
        <div style="color:#64748b; font-size:0.7rem;">إجمالي المحصل</div>
        <strong>${fmt(report.profitData.totalCollected)} ج.م</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">إجمالي المصروفات</div>
        <strong>${fmt(report.profitData.totalExpenses)} ج.م</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">صافي الأرباح</div>
        <strong style="color:#059669;">${fmt(report.profitData.actualProfit)} ج.م</strong>
      </div>
      <div>
        <div style="color:#64748b; font-size:0.7rem;">عدد المستثمرين</div>
        <strong>${report.distribution.length}</strong>
      </div>
    </div>
    
    <div style="margin-top:18px;">
      <strong style="font-size:0.9rem;">تفاصيل التوزيع</strong>
      <table class="print-doc-table" style="margin-top:8px; width:100%;">
        <thead>
          <tr style="background:#f1f5f9; font-weight:bold;">
            <th style="padding:8px; text-align:right;">اسم المستثمر</th>
            <th style="padding:8px; text-align:center;">نسبة المساهمة</th>
            <th style="padding:8px; text-align:left;">رأس المال</th>
            <th style="padding:8px; text-align:left;">نصيبه من الأرباح</th>
            <th style="padding:8px; text-align:left;">المسحوب</th>
            <th style="padding:8px; text-align:left;">المتبقي</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
    
    <div style="margin-top:18px; padding:12px; background:#fef3c7; border-radius:8px; border-left:4px solid #f59e0b; font-size:0.85rem;">
      <strong>ملاحظات:</strong>
      <ul style="margin:8px 0 0 20px; padding:0;">
        <li>التقرير يعكس الأرباح المحصلة فعلياً من الأقساط المسددة فقط</li>
        <li>التوزيع يتم بناءً على نسبة رأس مال كل مستثمر من الإجمالي</li>
        <li>المبالغ المسحوبة سابقاً تم خصمها من الحساب</li>
      </ul>
    </div>
    
    <div class="print-doc-footer">تم إصدار هذا التقرير إلكترونياً من نظام ${escapeHTML(companyName)}</div>
  `;
  
  printHTML(html);
  logAction('عرض تقرير توزيع', 'عرض تقرير توزيع الأرباح المحصلة بين جميع المستثمرين');
};

/**
 * عرض تقرير مقارن: الأرباح المحصلة vs الإجمالية
 */
window.viewProfitComparisonReport = function() {
  const report = generateProfitComparisonReport();
  const companyName = db.settings.companyName || 'شركة SKY';
  const fmt = (n) => Math.round(n).toLocaleString();
  
  const html = `
    <div class="print-doc-header">
      <div>
        <div style="font-weight:800; font-size:1.2rem; color:#0d9488;">${escapeHTML(companyName)}</div>
        <div style="font-size:0.75rem; color:#64748b;">تقرير مقارن: الأرباح المحصلة vs الإجمالية</div>
      </div>
      <div style="text-align:left; font-size:0.8rem;">
        <div><strong>تاريخ الإصدار:</strong> ${new Date().toLocaleString('ar-EG')}</div>
      </div>
    </div>
    
    <div class="print-doc-title">تقرير مقارن: الأرباح المحصلة مقابل الأرباح الإجمالية</div>
    
    <div style="margin-top:18px; padding:12px; background:#dbeafe; border-radius:8px; border-left:4px solid #0284c7;">
      <strong style="font-size:0.9rem;">الأرباح المحصلة فعلياً</strong>
      <table class="print-doc-table" style="margin-top:8px;">
        <tr>
          <td style="text-align:right; padding:6px;">إجمالي المحصل من الأقساط</td>
          <td style="text-align:left; font-weight:bold;">${fmt(report.actualCollected.totalCollected)} ج.م</td>
        </tr>
        <tr>
          <td style="text-align:right; padding:6px;">إجمالي المصروفات التشغيلية</td>
          <td style="text-align:left; font-weight:bold;">${fmt(report.actualCollected.totalExpenses)} ج.م</td>
        </tr>
        <tr style="border-top:2px solid #0284c7;">
          <td style="text-align:right; padding:6px; font-weight:bold;">صافي الأرباح المحصلة</td>
          <td style="text-align:left; font-weight:bold; color:#059669;">${fmt(report.actualCollected.netProfit)} ج.م</td>
        </tr>
        <tr>
          <td style="text-align:right; padding:6px; font-size:0.85rem;">عدد الأقساط المسددة</td>
          <td style="text-align:left; font-weight:bold;">${report.actualCollected.paidInstallmentsCount}</td>
        </tr>
      </table>
    </div>
    
    <div style="margin-top:18px; padding:12px; background:#ecfdf5; border-radius:8px; border-left:4px solid #0d9488;">
      <strong style="font-size:0.9rem;">الأرباح الإجمالية المتوقعة</strong>
      <table class="print-doc-table" style="margin-top:8px;">
        <tr>
          <td style="text-align:right; padding:6px;">إجمالي أصول الشركة الحالية</td>
          <td style="text-align:left; font-weight:bold;">${fmt(report.projectedTotal.totalAssets)} ج.م</td>
        </tr>
        <tr>
          <td style="text-align:right; padding:6px;">إجمالي رأس المال المستثمَر</td>
          <td style="text-align:left; font-weight:bold;">${fmt(report.projectedTotal.totalCapital)} ج.م</td>
        </tr>
        <tr style="border-top:2px solid #0d9488;">
          <td style="text-align:right; padding:6px; font-weight:bold;">صافي الأرباح الإجمالية</td>
          <td style="text-align:left; font-weight:bold; color:#059669;">${fmt(report.projectedTotal.netProfit)} ج.م</td>
        </tr>
        <tr>
          <td style="text-align:right; padding:6px; font-size:0.85rem;">الأقساط المعلقة لم تُحصل بعد</td>
          <td style="text-align:left; font-weight:bold; color:#d97706;">${fmt(report.projectedTotal.totalOutstandingInstallments)} ج.م</td>
        </tr>
      </table>
    </div>
    
    <div style="margin-top:18px; padding:12px; background:#fef3c7; border-radius:8px; border-left:4px solid #f59e0b;">
      <strong style="font-size:0.9rem;">مؤشرات الأداء</strong>
      <table class="print-doc-table" style="margin-top:8px;">
        <tr>
          <td style="text-align:right; padding:6px;">معدل التحصيل</td>
          <td style="text-align:left; font-weight:bold;">${report.comparison.collectionRate}%</td>
        </tr>
        <tr>
          <td style="text-align:right; padding:6px;">هامش الربح من المحصل</td>
          <td style="text-align:left; font-weight:bold;">${report.comparison.profitMargin}%</td>
        </tr>
        <tr>
          <td style="text-align:right; padding:6px;">المتبقي للتحصيل</td>
          <td style="text-align:left; font-weight:bold; color:#d97706;">${fmt(report.comparison.remainingToCollect)} ج.م</td>
        </tr>
      </table>
    </div>
    
    <div class="print-doc-footer">تم إصدار هذا التقرير إلكترونياً من نظام ${escapeHTML(companyName)}</div>
  `;
  
  printHTML(html);
  logAction('عرض تقرير مقارن', 'عرض التقرير المقارن بين الأرباح المحصلة والإجمالية');
};

// ================= تصدير البيانات إلى Excel =================
/**
 * تصدير تقرير توزيع الأرباح إلى Excel
 */
window.exportProfitDistributionToExcel = function() {
  const report = distributeActualProfitToInvestors();
  
  if (!report.distribution || report.distribution.length === 0) {
    alert('لا توجد بيانات لتصديرها');
    return;
  }
  
  const companyName = db.settings.companyName || 'شركة SKY';
  
  // تحضير البيانات للتصدير
  const data = [
    ['تقرير توزيع الأرباح المحصلة فعلياً'],
    ['شركة: ' + companyName],
    ['تاريخ الإصدار: ' + new Date().toLocaleString('ar-EG')],
    [],
    ['ملخص المالي:'],
    ['إجمالي المحصل من الأقساط', report.profitData.totalCollected],
    ['إجمالي المصروفات التشغيلية', report.profitData.totalExpenses],
    ['صافي الأرباح المحصلة', report.profitData.actualProfit],
    [],
    ['تفاصيل التوزيع:'],
    ['اسم المستثمر', 'نسبة المساهمة %', 'رأس المال', 'نصيبه من الأرباح', 'المسحوب فعلياً', 'المتبقي له'],
    ...report.distribution.map(d => [
      d.investorName,
      d.capitalRatio,
      d.capitalAmount,
      d.totalProfitShare,
      d.alreadyWithdrawn,
      d.remainingDue
    ])
  ];
  
  // استخدام SheetJS إذا كان متاحاً
  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'توزيع الأرباح');
    XLSX.writeFile(wb, `profit-distribution-${new Date().getTime()}.xlsx`);
    logAction('تصدير Excel', 'تصدير تقرير توزيع الأرباح إلى Excel');
  } else {
    alert('مكتبة Excel غير متاحة');
  }
};
