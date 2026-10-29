declare module 'exceljs/dist/exceljs.min.js' {
  const ExcelJS: {Workbook: typeof import('exceljs').Workbook};
  export default ExcelJS;
}
