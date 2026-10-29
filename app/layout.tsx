import type { Metadata } from "next";
import "./globals.css";
// Keep dashboard styles mounted while its modules change during navigation/HMR.
import "@/modules/resumo/styles.css";
import "@/modules/resumo/dashboard.css";
import "@/modules/resumo/financialChart.css";
import "@/modules/resumo/financial-composition.css";
import "@/modules/dashboard-market/market.css";
import "@/modules/dashboard-news/news.css";
import "@/modules/dashboard-news/weather.css";
import {DataProvider} from "@/shared/query/DataProvider";
import { AppProvider } from "@/shared/state/AppProvider";
import {WorkspaceCompanyProvider} from "@/shared/state/WorkspaceCompanyProvider";
import { AssetPreloadRecovery } from "@/shared/runtime/AssetPreloadRecoveryGuard";
export const metadata: Metadata = {title:"Controle de Faturamento",description:"Cadastros, contratos e agenda em um só lugar.",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="pt-BR"><body><AssetPreloadRecovery/><DataProvider><WorkspaceCompanyProvider><AppProvider>{children}</AppProvider></WorkspaceCompanyProvider></DataProvider></body></html>}
