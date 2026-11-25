import { Onest } from "next/font/google";
import "./globals.css";
const onest = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-onest" });
export const metadata = { title: "ФОП Поруч — консультації та ШІ-помічник" };
export default function Layout({ children }) {
  return <html lang="uk"><body className={`${onest.variable} font-sans`}>{children}</body></html>;
}
