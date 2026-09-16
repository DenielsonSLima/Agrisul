export type ReportOrientation = "portrait" | "landscape";
export type ReportHeaderVariantName = "compact" | "detailed";
export type ReportLogoAlignment = "left" | "center" | "right";

export type ReportHeaderVariant = {
  variant: ReportHeaderVariantName;
  logoAlignment: ReportLogoAlignment;
  showCnpj: boolean;
  showContact: boolean;
};

export type ReportCompanyBrand = {
  id: string;
  name: string;
  legalName: string;
  cnpj: string;
  phone: string;
  email: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zipCode: string;
  logoUrl: string | null;
};

export type ReportWatermarkBrand = {
  imageUrl: string | null;
  opacity: number;
  size: number;
};

export type ReportIssuer = {id: string; name: string; email: string};
export type ReportPdfBrand = {company: ReportCompanyBrand | null; header: ReportHeaderVariant; watermark: ReportWatermarkBrand; issuer: ReportIssuer; issuedAt: Date};
