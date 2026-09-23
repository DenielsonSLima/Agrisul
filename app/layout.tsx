import type { Metadata } from "next";
import "./globals.css";
import {DataProvider} from "@/shared/query/DataProvider";
import { AppProvider } from "@/shared/state/AppProvider";
import {WorkspaceCompanyProvider} from "@/shared/state/WorkspaceCompanyProvider";
import { AssetPreloadRecovery } from "@/shared/runtime/AssetPreloadRecoveryGuard";
export const metadata: Metadata = {title:"Controle de Faturamento",description:"Cadastros, contratos e agenda em um só lugar.",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="pt-BR"><body><AssetPreloadRecovery/><DataProvider><WorkspaceCompanyProvider><AppProvider>{children}</AppProvider></WorkspaceCompanyProvider></DataProvider></body></html>}
