// Keep the optimized dependency behind a stable, local lazy-module URL.
// After a Vite restart, this module is transformed with the current dependency
// hash instead of leaving long-lived pages pointing at an obsolete jspdf URL.
export {jsPDF} from 'jspdf';
