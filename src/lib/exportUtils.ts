import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';
import { FinancialReportColumn } from '../types/sbms';

export interface ExcelExportParams {
  filename: string;
  sheetName: string;
  bakeryName: string;
  reportTitle: string;
  periodLabel: string;
  columns: FinancialReportColumn[];
  rows: Record<string, string | number>[];
  summaryEntries?: { label: string; value: string | number }[];
}

export function exportToExcelXlsx(params: ExcelExportParams) {
  const {
    filename,
    sheetName,
    bakeryName,
    reportTitle,
    periodLabel,
    columns,
    rows,
    summaryEntries = [],
  } = params;

  const generatedStamp = new Date().toLocaleString('ar-SD', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const aoa: (string | number)[][] = [
    [bakeryName],
    [reportTitle],
    [`الفترة: ${periodLabel} · تاريخ الإصدار: ${generatedStamp}`],
    [],
    columns.map((c) => c.label),
    ...rows.map((r) =>
      columns.map((c) => {
        const v = r[c.key];
        return v === undefined || v === null ? '' : v;
      })
    ),
  ];

  if (summaryEntries.length > 0) {
    aoa.push([]);
    aoa.push(['الملخص المالي والإجماليات']);
    for (const s of summaryEntries) {
      aoa.push([s.label, s.value]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!views'] = [{ rightToLeft: true }];
  ws['!cols'] = columns.map((c) => ({
    wch: Math.max(
      14,
      c.label.length + 4,
      ...rows.slice(0, 50).map((r) => String(r[c.key] ?? '').length + 2)
    ),
  }));

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || 'Report');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export async function exportElementToPdf(params: {
  element: HTMLElement;
  filename: string;
}): Promise<void> {
  const { element, filename } = params;
  const baseOptions = {
    backgroundColor: '#FFFFFF',
    pixelRatio: 2,
    preferredFontFormat: 'woff2',
    filter: (node: HTMLElement) => {
      if (node instanceof HTMLElement && node.classList.contains('no-print')) {
        return false;
      }
      return true;
    },
  };

  let dataUrl: string;
  try {
    dataUrl = await toPng(element, baseOptions);
  } catch {
    dataUrl = await toPng(element, { ...baseOptions, skipFonts: true });
  }

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });

  const pdf = new jsPDF({
    orientation: img.width > img.height * 1.15 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  const imgHeightMm = (img.height * usableWidth) / img.width;
  let heightLeft = imgHeightMm;
  let position = margin;

  pdf.addImage(dataUrl, 'PNG', margin, position, usableWidth, imgHeightMm);
  heightLeft -= usableHeight;

  while (heightLeft > 1) {
    position = margin - (imgHeightMm - heightLeft);
    pdf.addPage();
    pdf.addImage(dataUrl, 'PNG', margin, position, usableWidth, imgHeightMm);
    heightLeft -= usableHeight;
  }

  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
