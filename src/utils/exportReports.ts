import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type { CategoryDefinition } from '../constants/taxonomy';
import type { NewsArticleRecord } from '../App';

export interface ExportReportContext {
  articles: NewsArticleRecord[];
  allCategories: CategoryDefinition[];
  categoryCounts: Record<string, number>;
  selectedCategory: string;
  startDateFilter: string;
  endDateFilter: string;
  portalFilter: string;
  districtFilter: string;
  searchQuery: string;
}

function getDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 1. CSV Export (.csv)
export function exportToCsv(ctx: ExportReportContext): void {
  const headers = [
    'ক্রমিক নং (SL)',
    'প্রকাশের তারিখ (Date)',
    'ক্যাটাগরি (Category)',
    'জেলা/অঞ্চল (District)',
    'নিউজ পোর্টাল (Portal)',
    'শিরোনাম (Headline)',
    'কি-ওয়ার্ডসমূহ (Matched Keywords)',
    'যাচাইকরণ স্ট্যাটাস (Status)',
    'গবেষক নোট (Notes)',
    'সংবাদ লিংক (URL)',
  ];

  const rows = ctx.articles.map((a, idx) => [
    idx + 1,
    a.publishedDate,
    `"${a.category.replace(/"/g, '""')}"`,
    `"${a.district.replace(/"/g, '""')}"`,
    `"${a.portalName.replace(/"/g, '""')}"`,
    `"${a.title.replace(/"/g, '""')}"`,
    `"${a.matchedKeywords.replace(/"/g, '""')}"`,
    a.verificationStatus,
    `"${(a.notes || '').replace(/"/g, '""')}"`,
    a.url,
  ]);

  const csvContent =
    '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bd_crime_news_report_${getDateStamp()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// 2. Excel Export (.xlsx)
export function exportToExcel(ctx: ExportReportContext): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: News Articles Data
  const articleRows = ctx.articles.map((a, idx) => ({
    'ক্রমিক নং': idx + 1,
    'প্রকাশের তারিখ': a.publishedDate,
    'ক্যাটাগরি': a.category,
    'জেলা / অঞ্চল': a.district,
    'নিউজ পোর্টাল': a.portalName,
    'সংবাদ শিরোনাম': a.title,
    'সনাক্তকৃত কি-ওয়ার্ড': a.matchedKeywords,
    'স্ট্যাটাস': a.verificationStatus,
    'তদন্ত নোট': a.notes || '',
    'সংক্ষিপ্ত বিবরণী': a.summary,
    'সংবাদ লিংক (URL)': a.url,
  }));

  const wsArticles = XLSX.utils.json_to_sheet(
    articleRows.length > 0
      ? articleRows
      : [
          {
            'ক্রমিক নং': 1,
            'প্রকাশের তারিখ': getDateStamp(),
            'ক্যাটাগরি': 'কোনো তথ্য নেই',
            'জেলা / অঞ্চল': '-',
            'নিউজ পোর্টাল': '-',
            'সংবাদ শিরোনাম': 'নির্বাচিত ফিল্টারে কোনো সংবাদ পাওয়া যায়নি',
            'সনাক্তকৃত কি-ওয়ার্ড': '-',
            'স্ট্যাটাস': '-',
            'তদন্ত নোট': '',
            'সংক্ষিপ্ত বিবরণী': '',
            'সংবাদ লিংক (URL)': '',
          },
        ]
  );

  wsArticles['!cols'] = [
    { wch: 10 },
    { wch: 14 },
    { wch: 24 },
    { wch: 16 },
    { wch: 20 },
    { wch: 55 },
    { wch: 32 },
    { wch: 14 },
    { wch: 25 },
    { wch: 60 },
    { wch: 45 },
  ];

  XLSX.utils.book_append_sheet(wb, wsArticles, 'সংবাদের তালিকা');

  // Sheet 2: Category & Portal Statistical Summary
  const totalCount = ctx.articles.length;
  const filteredCategoryCounts: Record<string, number> = {};
  for (const art of ctx.articles) {
    filteredCategoryCounts[art.category] = (filteredCategoryCounts[art.category] || 0) + 1;
  }

  const summaryRows = ctx.allCategories.map((cat, idx) => {
    const count = filteredCategoryCounts[cat.name] || 0;
    const pct = totalCount > 0 ? `${((count / totalCount) * 100).toFixed(1)}%` : '0.0%';
    return {
      'ক্রমিক নং': idx + 1,
      'অপরাধ ও ঘটনা ক্যাটাগরি': cat.name,
      'ধরন': cat.isCustom ? 'কাস্টম ক্যাটাগরি' : 'ডিফল্ট ক্যাটাগরি',
      'ব্যবহৃত কি-ওয়ার্ডসমূহ': cat.defaultKeywords.join(', '),
      'ফিল্টারকৃত সংবাদের সংখ্যা': count,
      'শতাংশ হার': pct,
      'সর্বমোট ডাটাবেজ সংখ্যা': ctx.categoryCounts[cat.name] || 0,
    };
  });

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 10 },
    { wch: 28 },
    { wch: 18 },
    { wch: 50 },
    { wch: 24 },
    { wch: 14 },
    { wch: 22 },
  ];

  XLSX.utils.book_append_sheet(wb, wsSummary, 'ক্যাটাগরি পরিসংখ্যান');

  XLSX.writeFile(wb, `bd_crime_news_report_${getDateStamp()}.xlsx`);
}

// 3. Word Export (.doc)
export function exportToWord(ctx: ExportReportContext): void {
  const totalCount = ctx.articles.length;
  const filteredCategoryCounts: Record<string, number> = {};
  for (const art of ctx.articles) {
    filteredCategoryCounts[art.category] = (filteredCategoryCounts[art.category] || 0) + 1;
  }

  const filterSummaryText = [
    `ক্যাটাগরি: ${ctx.selectedCategory === 'all' ? 'সকল ক্যাটাগরি' : ctx.selectedCategory}`,
    `তারিখ সীমা: ${ctx.startDateFilter || 'শুরু'} থেকে ${ctx.endDateFilter || 'আজ পর্যন্ত'}`,
    `পোর্টাল: ${ctx.portalFilter === 'all' ? 'সকল পোর্টাল' : ctx.portalFilter}`,
    `জেলা: ${ctx.districtFilter === 'all' ? 'সকল জেলা' : ctx.districtFilter}`,
  ].join(' | ');

  const categoryRowsHtml = ctx.allCategories
    .map((cat, idx) => {
      const count = filteredCategoryCounts[cat.name] || 0;
      const pct = totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0.0';
      return `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td><strong>${escapeHtml(cat.name)}</strong></td>
          <td>${escapeHtml(cat.defaultKeywords.slice(0, 8).join(', '))}</td>
          <td style="text-align:right;"><strong>${count}</strong></td>
          <td style="text-align:right;">${pct}%</td>
        </tr>
      `;
    })
    .join('');

  const articleRowsHtml = ctx.articles
    .map(
      (art, idx) => `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td style="white-space:nowrap;">${escapeHtml(art.publishedDate)}</td>
        <td><strong>${escapeHtml(art.category)}</strong></td>
        <td>${escapeHtml(art.district)}</td>
        <td>${escapeHtml(art.portalName)}</td>
        <td>
          <div><strong>${escapeHtml(art.title)}</strong></div>
          <div style="font-size:9.5pt;color:#475569;margin-top:3px;">${escapeHtml(art.summary)}</div>
        </td>
        <td>${escapeHtml(art.matchedKeywords)}</td>
        <td><a href="${escapeHtml(art.url)}">মূল সংবাদ লিংক</a></td>
      </tr>
    `
    )
    .join('');

  const htmlDocument = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <title>BD Crime & Incident News Report</title>
        <style>
          @page {
            size: 29.7cm 21cm;
            margin: 1.5cm;
            mso-page-orientation: landscape;
          }
          body {
            font-family: 'Hind Siliguri', 'Nirmala UI', 'Kalpurush', Arial, sans-serif;
            color: #0f172a;
            font-size: 10.5pt;
            line-height: 1.45;
          }
          h1 {
            font-size: 16pt;
            margin-bottom: 4px;
            color: #0f172a;
          }
          h2 {
            font-size: 12.5pt;
            margin-top: 18px;
            margin-bottom: 8px;
            color: #1e293b;
            border-bottom: 1px solid #cbd5e1;
            padding-bottom: 4px;
          }
          .meta {
            font-size: 9.5pt;
            color: #475569;
            margin-bottom: 14px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
          }
          th, td {
            border: 1px solid #cbd5e1;
            padding: 6px 8px;
            vertical-align: top;
            font-size: 9.5pt;
          }
          th {
            background-color: #f1f5f9;
            font-weight: bold;
            text-align: left;
          }
        </style>
      </head>
      <body>
        <h1>বাংলাদেশ অপরাধ ও ঘটনা সংবাদ ডাটাবেজ রিপোর্ট (BD Crime Archive)</h1>
        <div class="meta">
          <div>রিপোর্ট তৈরির তারিখ: ${escapeHtml(getDateStamp())} | মোট সংবাদের সংখ্যা: <strong>${totalCount}</strong></div>
          <div>প্রয়োগকৃত ফিল্টার: ${escapeHtml(filterSummaryText)}</div>
        </div>

        <h2>০১. ক্যাটাগরি ভিত্তিক সংবাদের সংক্ষিপ্ত পরিসংখ্যান</h2>
        <table>
          <thead>
            <tr>
              <th style="width:45px;">ক্রমিক</th>
              <th style="width:180px;">ক্যাটাগরি</th>
              <th>প্রধান কি-ওয়ার্ডসমূহ</th>
              <th style="width:90px;text-align:right;">সংবাদ সংখ্যা</th>
              <th style="width:80px;text-align:right;">শতাংশ</th>
            </tr>
          </thead>
          <tbody>
            ${categoryRowsHtml}
          </tbody>
        </table>

        <h2>০২. সংগৃহীত সংবাদের বিস্তারিত তালিকা (${totalCount}টি রেকর্ড)</h2>
        <table>
          <thead>
            <tr>
              <th style="width:40px;">নং</th>
              <th style="width:85px;">তারিখ</th>
              <th style="width:120px;">ক্যাটাগরি</th>
              <th style="width:85px;">জেলা</th>
              <th style="width:100px;">পোর্টাল</th>
              <th>সংবাদ শিরোনাম ও সংক্ষিপ্ত বিবরণী</th>
              <th style="width:120px;">কি-ওয়ার্ড</th>
              <th style="width:80px;">সূত্র</th>
            </tr>
          </thead>
          <tbody>
            ${articleRowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob(['\uFEFF', htmlDocument], {
    type: 'application/msword;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bd_crime_news_report_${getDateStamp()}.doc`;
  link.click();
  URL.revokeObjectURL(url);
}

// 4. PDF Export (.pdf) — Renders Bengali HTML with Hind Siliguri via html2canvas + jsPDF
export async function exportToPdf(ctx: ExportReportContext): Promise<void> {
  const totalCount = ctx.articles.length;
  const filteredCategoryCounts: Record<string, number> = {};
  for (const art of ctx.articles) {
    filteredCategoryCounts[art.category] = (filteredCategoryCounts[art.category] || 0) + 1;
  }

  const filterSummaryText = [
    `ক্যাটাগরি: ${ctx.selectedCategory === 'all' ? 'সকল ক্যাটাগরি' : ctx.selectedCategory}`,
    `তারিখ সীমা: ${ctx.startDateFilter || 'শুরু'} থেকে ${ctx.endDateFilter || 'আজ পর্যন্ত'}`,
    `পোর্টাল: ${ctx.portalFilter === 'all' ? 'সকল পোর্টাল' : ctx.portalFilter}`,
    `জেলা: ${ctx.districtFilter === 'all' ? 'সকল জেলা' : ctx.districtFilter}`,
  ].join(' · ');

  // Build an off-screen container with exact A4 width (794px at 96dpi)
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '860px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#0f172a';
  container.style.padding = '32px';
  container.style.fontFamily = "'Hind Siliguri', 'Plus Jakarta Sans', sans-serif";

  const pdfArticles = ctx.articles.slice(0, 120);

  const categoryRowsHtml = ctx.allCategories
    .map((cat, idx) => {
      const count = filteredCategoryCounts[cat.name] || 0;
      const pct = totalCount > 0 ? ((count / totalCount) * 100).toFixed(1) : '0.0';
      return `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${idx + 1}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:600;">${escapeHtml(cat.name)}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;color:#475569;">${escapeHtml(cat.defaultKeywords.slice(0, 6).join(', '))}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;font-weight:600;">${count}</td>
          <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:right;">${pct}%</td>
        </tr>
      `;
    })
    .join('');

  const articleRowsHtml = pdfArticles
    .map(
      (art, idx) => `
      <tr>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;text-align:center;">${idx + 1}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;white-space:nowrap;font-family:monospace;">${escapeHtml(art.publishedDate)}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;font-weight:600;color:#b91c1c;">${escapeHtml(art.category)}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;">${escapeHtml(art.portalName)}<br/><span style="color:#64748b;font-size:10px;">জেলা: ${escapeHtml(art.district)}</span></td>
        <td style="border:1px solid #cbd5e1;padding:6px 8px;">
          <div style="font-weight:600;color:#0f172a;margin-bottom:2px;">${escapeHtml(art.title)}</div>
          <div style="color:#64748b;font-size:10.5px;">কি-ওয়ার্ড: ${escapeHtml(art.matchedKeywords)}</div>
        </td>
      </tr>
    `
    )
    .join('');

  container.innerHTML = `
    <div style="border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px;">
      <h1 style="font-size:20px;font-weight:700;margin:0 0 6px 0;color:#0f172a;">
        বাংলাদেশ অপরাধ ও ঘটনা সংবাদ আর্কাইভ রিপোর্ট (BD Crime Archive)
      </h1>
      <div style="font-size:12px;color:#475569;">
        তারিখ: ${escapeHtml(getDateStamp())} · মোট সংরক্ষিত ও ফিল্টারকৃত সংবাদ: <strong>${totalCount}</strong>
      </div>
      <div style="font-size:11.5px;color:#475569;margin-top:3px;">
        ${escapeHtml(filterSummaryText)}
      </div>
    </div>

    <div style="margin-bottom:20px;">
      <h2 style="font-size:14px;font-weight:600;margin:0 0 8px 0;color:#0f172a;">
        ০১. অপরাধ ও ঘটনা ক্যাটাগরি অনুযায়ী পরিসংখ্যান (${ctx.allCategories.length}টি ক্যাটাগরি)
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1;padding:6px 8px;width:45px;text-align:center;">নং</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;width:160px;text-align:left;">ক্যাটাগরি</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;text-align:left;">প্রধান কি-ওয়ার্ডসমূহ</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;width:85px;text-align:right;">সংবাদ সংখ্যা</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;width:75px;text-align:right;">শতাংশ</th>
          </tr>
        </thead>
        <tbody>
          ${categoryRowsHtml}
        </tbody>
      </table>
    </div>

    <div>
      <h2 style="font-size:14px;font-weight:600;margin:0 0 8px 0;color:#0f172a;">
        ০২. সংবাদের বিস্তারিত তালিকা (${pdfArticles.length}টি রেকর্ড)
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="border:1px solid #cbd5e1;padding:6px 8px;width:40px;text-align:center;">নং</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;width:85px;text-align:left;">তারিখ</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;width:120px;text-align:left;">ক্যাটাগরি</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;width:130px;text-align:left;">পোর্টাল ও জেলা</th>
            <th style="border:1px solid #cbd5e1;padding:6px 8px;text-align:left;">শিরোনাম ও কি-ওয়ার্ড</th>
          </tr>
        </thead>
        <tbody>
          ${articleRowsHtml}
        </tbody>
      </table>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    const imgHeight = (canvas.height * usableWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, 'JPEG', margin, position, usableWidth, imgHeight);
    heightLeft -= usableHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', margin, position, usableWidth, imgHeight);
      heightLeft -= usableHeight;
    }

    pdf.save(`bd_crime_news_report_${getDateStamp()}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
