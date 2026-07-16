import "./globals.css";

export const metadata = {
  title: "Truck List Maker",
  description: "Deterministic truck-list review, classification, and export",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

