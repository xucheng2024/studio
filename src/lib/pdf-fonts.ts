import path from "node:path";
import { Font } from "@react-pdf/renderer";

export const PDF_FONT_FAMILY: string[] = ["NotoSans", "NotoSansSC"];
export const PDF_FONT_BOLD = { fontFamily: PDF_FONT_FAMILY, fontWeight: 700 as const };

let registered = false;

function fontFile(pkg: string, file: string) {
  return path.join(process.cwd(), "node_modules", "@fontsource", pkg, "files", file);
}

export function registerPdfFonts() {
  if (registered) return;
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: fontFile("noto-sans", "noto-sans-latin-400-normal.woff"), fontWeight: 400 },
      { src: fontFile("noto-sans", "noto-sans-latin-700-normal.woff"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "NotoSansSC",
    fonts: [
      { src: fontFile("noto-sans-sc", "noto-sans-sc-chinese-simplified-400-normal.woff"), fontWeight: 400 },
      { src: fontFile("noto-sans-sc", "noto-sans-sc-chinese-simplified-700-normal.woff"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
