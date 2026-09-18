import type {ReportWatermarkBrand} from "./types";
import Image from "next/image";

export function ReportWatermark({watermark}:{watermark:ReportWatermarkBrand}){
 if(!watermark.imageUrl)return null;
 return <div className="report-document-watermark" aria-hidden="true" style={{width:`${watermark.size}%`,height:`${watermark.size}%`,opacity:watermark.opacity/100}}><Image src={watermark.imageUrl} alt="" fill unoptimized style={{objectFit:'contain'}} sizes="(max-width: 850px) 80vw, 45vw"/></div>;
}
